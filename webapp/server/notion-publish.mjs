// 노션 발행 — 마스터 GDD·보고서를 오너의 노션 워크스페이스에 아카이브한다.
// 디자인은 오너의 레퍼런스 페이지("최슬왕"/"슬라임 김치" 대시보드)를 따른다:
//   허브 페이지 = 볼드 피치 → 구분선 → 게임 개요 표(파란 헤딩) → 기획서 콜아웃 → 섹션별 자식 페이지.
// 토큰은 config/notion.json (커밋 금지 — .gitignore) 에 저장. Notion 내부 통합(Internal Integration) 토큰 사용.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG_FILE = path.resolve(__dirname, "..", "..", "config", "notion.json");
const MAP_FILE = path.resolve(__dirname, "..", "..", "config", "notion-map.json");
const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/* ── 설정/매핑 ─────────────────────────────────────── */

export function loadCfg() {
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE, "utf-8"));
    return { token: String(j.token ?? ""), parentPageId: String(j.parentPageId ?? ""), auto: j.auto !== false };
  } catch {
    return { token: "", parentPageId: "", auto: true };
  }
}
export function saveCfg(cfg) {
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}
function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, "utf-8"));
  } catch {
    return {};
  }
}
function saveMap(m) {
  fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2), "utf-8");
}

/** 노션 페이지 URL/ID → 대시 UUID */
export function parsePageId(input) {
  const m = String(input ?? "").match(/([0-9a-f]{32})/i) ?? String(input ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return "";
  const hex = m[1].replace(/-/g, "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ── API 클라이언트 (3req/s 제한 준수) ─────────────── */

let lastCall = 0;
async function api(token, method, p, body) {
  const wait = 360 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const r = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion ${r.status}: ${j?.message ?? "요청 실패"}`);
  return j;
}

/** 로컬 이미지 파일을 노션 File Upload API로 올리고 file_upload id를 반환 (single_part, ≤20MB) */
async function uploadImageToNotion(token, filePath, filename) {
  const created = await api(token, "POST", "/file_uploads", { filename, content_type: "image/png" });
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(filePath)], { type: "image/png" }), filename);
  const r = await fetch(`${API}/file_uploads/${created.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    body: fd, // Content-Type은 FormData가 boundary 포함해 자동 설정
  });
  if (!r.ok) throw new Error(`파일 업로드 ${r.status}`);
  return created.id;
}

/** 토큰·부모 페이지 검증 — 성공 시 { user, pageTitle } */
export async function verifySetup(token, parentPageId) {
  const me = await api(token, "GET", "/users/me");
  const page = await api(token, "GET", `/pages/${parentPageId}`);
  const t = page?.properties?.title?.title?.map((x) => x?.plain_text ?? "").join("") ?? "(제목 없음)";
  return { user: me?.name ?? me?.bot?.owner?.type ?? "integration", pageTitle: t };
}

/* ── 마크다운 → 노션 블록 ──────────────────────────── */

/** 인라인 마크다운 → rich_text 배열 (**굵게** *기울임* `코드` [링크](url)) */
function rich(text, extra = {}) {
  const out = [];
  let s = String(text ?? "");
  // 노션 rich_text 항목당 2000자 제한
  const push = (content, ann = {}, link) => {
    if (!content) return;
    for (let i = 0; i < content.length; i += 1900) {
      out.push({
        type: "text",
        text: { content: content.slice(i, i + 1900), link: link ? { url: link } : undefined },
        annotations: { ...ann, ...extra },
      });
    }
  };
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/;
  let m;
  while ((m = re.exec(s)) !== null) {
    push(s.slice(0, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[3] !== undefined) push(m[3], { italic: true });
    else if (m[4] !== undefined) push(m[4], { code: true });
    else if (m[5] !== undefined) push(m[5], {}, m[6]);
    s = s.slice(m.index + m[0].length);
  }
  push(s);
  return out.length > 0 ? out : [{ type: "text", text: { content: "" } }];
}

const strip = (s) => s.replace(/\s+$/, "").replace(/\\([~*_`])/g, "$1");

/* ── Notion 코드블록 언어 정규화 ──
 * Notion API는 정해진 language 값만 받는다 — "text"·"txt" 같은 값이면 400
 * (body.children[N].code.language should be `abap`...). 별칭을 매핑하고, 모르면 plain text로. */
const NOTION_LANGS = new Set([
  "abap","arduino","bash","basic","c","clojure","coffeescript","c++","c#","css","dart","diff","docker",
  "elixir","elm","erlang","flow","fortran","f#","gherkin","glsl","go","graphql","groovy","haskell","html",
  "java","javascript","json","julia","kotlin","latex","less","lisp","livescript","lua","makefile","markdown",
  "markup","matlab","mermaid","nix","objective-c","ocaml","pascal","perl","php","plain text","powershell",
  "prolog","protobuf","python","r","reason","ruby","rust","sass","scala","scheme","scss","shell","sql",
  "swift","typescript","vb.net","verilog","vhdl","visual basic","webassembly","xml","yaml",
]);
const LANG_ALIAS = {
  text: "plain text", txt: "plain text", plaintext: "plain text", none: "plain text", "": "plain text",
  js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript", py: "python", rb: "ruby",
  sh: "shell", zsh: "shell", bat: "shell", cmd: "shell", ps1: "powershell", yml: "yaml", md: "markdown",
  cs: "c#", "c++": "c++", cpp: "c++", h: "c", hpp: "c++", htm: "html", golang: "go",
};
function notionLang(raw) {
  const k = (raw || "").trim().toLowerCase();
  const a = LANG_ALIAS[k] ?? k;
  return NOTION_LANGS.has(a) ? a : "plain text";
}

/* ── 리플로우 — 개행이 유실된(한 줄로 뭉친) 마크다운을 구조로 복원 ──
 * 일부 모델이 섹션 전체를 한 줄로 뱉는다: "### 제목 ... | a | b | |---|---| | c | d | ..."
 * 그대로 노션에 올리면 벽글이 되고 표가 문자로 보인다. LLM 없이 결정적으로 되살린다.
 */

/** 한 줄에 인라인으로 뭉친 파이프 표를 행 단위 표로 복원 */
function unflattenTableLine(line) {
  if (!/\|\s*:?-{2,}/.test(line)) return null; // 표 구분자(---)가 없으면 대상 아님
  if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) return null; // 이미 정상적인 구분자 줄은 그대로
  const first = line.indexOf("|");
  const last = line.lastIndexOf("|");
  if (first < 0 || last <= first) return null;
  const before = line.slice(0, first).trim();
  const after = line.slice(last + 1).trim();
  const tokens = line
    .slice(first + 1, last)
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c !== ""); // 행 경계 "| |"가 만든 빈 토큰 제거 (빈 셀은 희생)
  let sepStart = -1;
  let sepLen = 0;
  for (let k = 0; k < tokens.length; k++) {
    if (/^:?-{2,}:?$/.test(tokens[k])) {
      if (sepStart < 0) sepStart = k;
      sepLen++;
    } else if (sepStart >= 0) break;
  }
  if (sepStart <= 0 || sepLen === 0 || sepStart < sepLen) return null;
  const cols = sepLen;
  const header = tokens.slice(sepStart - cols, sepStart);
  const pre = tokens.slice(0, sepStart - cols).join(" ").trim(); // 헤더 앞 잔여 텍스트
  const body = tokens.slice(sepStart + sepLen);
  const outLines = [];
  const lead = [before, pre].filter(Boolean).join(" ").trim();
  if (lead) outLines.push(lead, "");
  outLines.push(`| ${header.join(" | ")} |`);
  outLines.push(`|${Array(cols).fill("---").join("|")}|`);
  for (let k = 0; k < body.length; k += cols) {
    const row = body.slice(k, k + cols);
    while (row.length < cols) row.push("");
    outLines.push(`| ${row.join(" | ")} |`);
  }
  if (after) outLines.push("", after);
  return outLines;
}

/** 개행 유실 마크다운 복원 — 헤딩·표·번호목록·불릿을 제 줄로 */
export function reflowMd(md) {
  const out = [];
  for (const rawLine of String(md ?? "").split(/\r?\n/)) {
    // ① 줄 중간의 헤딩(### )을 경계로 분할
    const pieces = rawLine.split(/\s+(?=#{2,4}\s)/);
    for (let piece of pieces) {
      // ② 인라인으로 뭉친 표 복원
      const tbl = unflattenTableLine(piece);
      if (tbl) {
        for (const l of tbl) {
          if (/^\|/.test(l) || l === "") out.push(l);
          else out.push(...reflowMd(l).split("\n")); // 표 앞뒤 텍스트도 재귀 복원
        }
        continue;
      }
      // ③ 번호 목록 — " 1. …" 패턴이 2회 이상(줄 시작 항목 포함)이면 항목마다 줄바꿈
      const numHits = piece.match(/\s\*{0,2}\d{1,2}[.)]\s+(?=\*\*|[가-힣A-Za-z"'『「(\[])/g);
      const startsWithItem = /^\s*\*{0,2}\d{1,2}[.)]\s/.test(piece);
      if (numHits && numHits.length + (startsWithItem ? 1 : 0) >= 2) {
        piece = piece.replace(/\s(\*{0,2}\d{1,2}[.)]\s+)(?=\*\*|[가-힣A-Za-z"'『「(\[])/g, "\n$1");
      }
      // ④ 불릿 — " - …"가 2회 이상이면 항목마다 줄바꿈 (숫자 범위 "1 - 2"는 제외)
      const bulHits = piece.match(/[^\d\s]\s+-\s+\S/g);
      if (bulHits && bulHits.length >= 2) {
        piece = piece.replace(/([^\d\s])\s+-\s+(?=\S)/g, "$1\n- ");
      }
      out.push(...piece.split("\n"));
    }
  }
  return out.join("\n");
}

/** 마크다운 본문 → 노션 블록 배열 (헤딩/불릿/번호/인용/코드/표/구분선/이미지) */
export function mdToBlocks(md) {
  const blocks = [];
  const lines = reflowMd(String(md ?? "")).split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    // 코드 펜스
    const fence = /^```(\w*)/.exec(t);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      blocks.push({
        type: "code",
        code: { rich_text: rich(buf.join("\n").slice(0, 1900)), language: notionLang(fence[1]) },
      });
      continue;
    }
    // 표 (| a | b |)
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() ?? "")) {
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => strip(c.trim()));
        if (!/^[\s:|-]+$/.test(cells.join(""))) rows.push(cells);
        i++;
      }
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({
        type: "table",
        table: {
          table_width: width,
          has_column_header: true,
          has_row_header: false,
          children: rows.slice(0, 98).map((r) => ({
            type: "table_row",
            table_row: { cells: Array.from({ length: width }, (_, c) => rich(r[c] ?? "")) },
          })),
        },
      });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push({ type: "divider", divider: {} });
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const lvl = Math.min(h[1].length, 3);
      const key = `heading_${lvl}`;
      blocks.push({ type: key, [key]: { rich_text: rich(strip(h[2])), color: lvl <= 2 ? "blue" : "default" } });
      i++;
      continue;
    }
    const todo = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(t);
    if (todo) {
      blocks.push({ type: "to_do", to_do: { rich_text: rich(strip(todo[2])), checked: todo[1].toLowerCase() === "x" } });
      i++;
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(t);
    if (bullet) {
      blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(strip(bullet[1])) } });
      i++;
      continue;
    }
    const num = /^\d+[.)]\s+(.*)$/.exec(t);
    if (num) {
      blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: rich(strip(num[1])) } });
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      blocks.push({ type: "quote", quote: { rich_text: rich(strip(t.replace(/^>\s?/, ""))) } });
      i++;
      continue;
    }
    const img = /^!\[[^\]]*\]\((\S+)\)/.exec(t);
    if (img) {
      // 내부 API 이미지는 노션이 접근 불가 — 외부 URL만 삽입
      if (/^https?:\/\//.test(img[1])) blocks.push({ type: "image", image: { type: "external", external: { url: img[1] } } });
      i++;
      continue;
    }
    // 연속 일반 줄은 한 단락으로 (마크다운 soft-wrap)
    const buf = [strip(t)];
    i++;
    while (i < lines.length) {
      const nt = lines[i].trim();
      if (!nt || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||!\[|-{3,}$)/.test(nt)) break;
      buf.push(strip(nt));
      i++;
    }
    blocks.push({ type: "paragraph", paragraph: { rich_text: rich(buf.join("\n").slice(0, 1900)) } });
  }
  return blocks;
}

/* ── GDD 파싱 (섹션 분리 + 개요 표 추출) ───────────── */

const SECTION_ICONS = {
  1: "🎮", 2: "🌌", 3: "🕹️", 4: "⚙️", 5: "🧭", 6: "⚖️", 7: "💰", 8: "🎨", 9: "🛠️", 10: "📅", 11: "📢",
};

export function splitSections(md) {
  const out = [];
  const re = /^##\s+(.+)$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(md)) !== null) heads.push({ title: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : md.length;
    const body = md.slice(heads[i].bodyStart, end).trim();
    if (/아직 작성되지 않음/.test(body) || !body) continue;
    const num = Number(/^(\d+)\./.exec(heads[i].title)?.[1] ?? 0);
    out.push({ num, title: heads[i].title, body, icon: SECTION_ICONS[num] ?? "📄" });
  }
  return out;
}

/** 개요 섹션 → 대시보드 발췌.
 * 정본 테이블(1-1)에서 핵심 5~7행만 뽑는다(전체 복사 금지 — 디자인 가이드 6조).
 * pitch = "### 1-2. …" 헤딩 문구, sub = 1-2 본문 첫 줄(피치 아래 한 줄 설명). */
function overviewFacts(overviewBody, projectName) {
  const body = String(overviewBody ?? "");
  const tblRows = [];
  let inTable = false;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.length >= 2 && !/^[-: ]+$/.test(cells.join(""))) tblRows.push([cells[0], cells[1]]);
      inTable = true;
    } else if (inTable && t !== "") break;
  }
  const findRow = (kw) => tblRows.find(([l]) => l.includes(kw))?.[1] ?? "";
  const pitch = /^###\s*1-2\.?\s*(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  let sub = "";
  const m12 = /^###\s*1-2[^\n]*\n+([^\n#|][^\n]*)/m.exec(body);
  if (m12) sub = m12[1].trim();
  const rows = [["항목", "내용"]];
  const put = (label, val) => { if (val) rows.push([label, val]); };
  put("가제", findRow("타이틀") || projectName || "(미정)");
  put("장르", findRow("장르"));
  put("대회·마감", findRow("대회"));
  put("주인공 / 주적", findRow("주인공"));
  put("팀", findRow("팀"));
  put("로그라인", sub);
  if (rows.length <= 2) {
    // 정본 테이블 없는 옛 문서 폴백 — 라벨 그렙
    const grab = (label) => new RegExp(`\\*\\*${label}[^*]*\\*\\*\\s*[:：]\\s*(.+)`).exec(body)?.[1]?.trim() ?? "";
    put("장르/플랫폼", grab("장르"));
    put("로그라인", grab("한 줄 피치"));
  }
  return { pitch, sub, rows };
}

/* ── 발행 ──────────────────────────────────────────── */

/** 블록 추가 — after를 주면 그 블록 '뒤'에 순서대로 삽입(위치 지정), 없으면 맨 아래. 마지막 생성 블록 id 반환. */
async function appendBlocks(token, blockId, blocks, after) {
  let cursor = after;
  let lastId = null;
  for (let i = 0; i < blocks.length; i += 90) {
    const body = { children: blocks.slice(i, i + 90) };
    if (cursor) body.after = cursor;
    const r = await api(token, "PATCH", `/blocks/${blockId}/children`, body);
    const res = r?.results ?? [];
    if (res.length > 0) {
      lastId = res[res.length - 1].id;
      if (cursor) cursor = lastId; // after 체인 — 다음 청크는 방금 넣은 것 뒤에
    }
  }
  return lastId;
}

async function deleteBlock(token, id) {
  try {
    await api(token, "DELETE", `/blocks/${id}`);
  } catch {
    /* 이미 지워진 블록 등은 무시 */
  }
}

/** 문서 내용 지문 — 같으면 노션 페이지를 일절 건드리지 않는다 (제자리 갱신의 핵심) */
const docHash = (d) => crypto.createHash("sha1").update(`${d.icon}\u0000${d.title}\u0000${d.md}`).digest("hex");


/** 2단 컬럼 삽입 — API는 한 요청 2단 중첩까지라(column_list→column→내용 = 3단 불가)
 * 자리표시자 문단으로 컬럼을 먼저 만들고 내용은 컬럼 id에 2차 append 후 자리표시자 제거.
 * (디자인 정본: docs/notion-design-guide.md 9조) */
async function appendColumnList(token, parentId, columns, after) {
  const body = {
    children: [{
      type: "column_list",
      column_list: { children: columns.map(() => ({ type: "column", column: { children: [{ type: "paragraph", paragraph: { rich_text: [] } }] } })) },
    }],
  };
  if (after) body.after = after;
  const r = await api(token, "PATCH", `/blocks/${parentId}/children`, body);
  const clId = r.results?.[0]?.id;
  if (!clId) return after ?? null;
  const cols = await listChildren(token, clId);
  for (let i = 0; i < cols.length && i < columns.length; i++) {
    const ph = (await listChildren(token, cols[i].id))[0];
    await appendBlocks(token, cols[i].id, columns[i]);
    if (ph?.type === "paragraph") await deleteBlock(token, ph.id);
  }
  return clId;
}
async function createChildPage(token, parentId, title, icon, blocks) {
  const page = await api(token, "POST", "/pages", {
    parent: { page_id: parentId },
    icon: icon ? { type: "emoji", emoji: icon } : undefined,
    properties: { title: { title: rich(title) } },
    children: blocks.slice(0, 90),
  });
  if (blocks.length > 90) await appendBlocks(token, page.id, blocks.slice(90));
  return page;
}

const callout = (emoji, richText, color = "blue_background", children) => ({
  type: "callout",
  callout: { icon: { type: "emoji", emoji }, rich_text: richText, color, ...(children?.length ? { children } : {}) },
});
const heading2 = (text, color = "blue") => ({ type: "heading_2", heading_2: { rich_text: rich(text), color } });

/**
 * 프로젝트 전체 발행 — 오너 레퍼런스(슬라임 김치 허브) 스타일 대시보드.
 * 디자인 정본: docs/notion-design-guide.md (오너 지시 2026-07-14 "가독성 — 레퍼런스처럼").
 *
 * 구조: 허브 = 대시보드(피치 → 개요 2단 컬럼 → 기획서 모음 콜아웃 링크 → 아트) /
 *       물리 문서 페이지는 맨 아래 "📦 문서 보관함" 한 곳에(레퍼런스의 '작업실' 위치).
 * 제자리 갱신: key(gdd:N/spec:ts/rep:ts)+내용 해시로 페이지 재사용(URL 유지·휴지통행 0).
 *       링크 콜아웃이 순서를 담당하므로 페이지 물리 순서 관리(구 prefix 로직)는 폐기.
 * 아트 발주서는 아트 명세서 페이지의 하위 페이지(parentKey).
 */
export async function publishProject({ projectId, projectName, gddMd, reports, keyVisuals }) {
  const cfg = loadCfg();
  if (!cfg.token || !cfg.parentPageId) throw new Error("노션 연동이 설정되지 않았습니다 — 토큰과 부모 페이지를 먼저 등록하세요");
  const map = loadMap();
  const rec = map[projectId] ?? {};
  let rootId = rec.rootPageId;

  // 허브 페이지 확보 (없거나 삭제됐으면 생성)
  if (rootId) {
    try {
      const p = await api(cfg.token, "GET", `/pages/${rootId}`);
      if (p.archived || p.in_trash) rootId = null;
    } catch {
      rootId = null;
    }
  }
  if (!rootId) {
    const page = await api(cfg.token, "POST", "/pages", {
      parent: { page_id: cfg.parentPageId },
      icon: { type: "emoji", emoji: "🎮" },
      properties: { title: { title: rich(projectName || projectId) } },
    });
    rootId = page.id;
    rec.anchorId = null;
  } else {
    await api(cfg.token, "PATCH", `/pages/${rootId}`, { properties: { title: { title: rich(projectName || projectId) } } });
  }

  // ── 앵커(맨 위 피치 문단) 확보 — 레이아웃 삽입 기준점 ──
  let children = await listChildren(cfg.token, rootId);
  let anchorId = rec.anchorId && children.some((b) => b.id === rec.anchorId) ? rec.anchorId : null;
  if (!anchorId) {
    // 앵커가 없으면 레이아웃 블록을 비우고 새로 시작 (물리 페이지는 보존)
    for (const b of children) if (b.type !== "child_page") await deleteBlock(cfg.token, b.id);
    anchorId = await appendBlocks(cfg.token, rootId, [{ type: "paragraph", paragraph: { rich_text: rich("") } }]);
  }
  const docsPrev = rec.docs ?? {};

  // ── 📦 문서 보관함 (물리 페이지 서가 — 허브 맨 아래) ──
  let storageId = rec.storageId ?? null;
  if (storageId) {
    try {
      const p = await api(cfg.token, "GET", `/pages/${storageId}`);
      if (p.archived || p.in_trash) storageId = null;
    } catch {
      storageId = null;
    }
  }
  if (!storageId) {
    // 반드시 허브의 '자식'으로 둔다 — 형제로 두면 오너가 허브만 공유했을 때 팀원에게 문서가 안 보인다
    // (권한 상속 단절, 2026-07-14 실사고). column_list quirk는 역순 삽입 레이아웃으로 회피(아래 참조).
    const page = await api(cfg.token, "POST", "/pages", {
      parent: { page_id: rootId },
      icon: { type: "emoji", emoji: "📦" },
      properties: { title: { title: rich("문서 보관함") } },
      children: mdToBlocks("> 발행 파이프라인의 물리 보관함 — 문서 열람은 허브 대시보드의 링크로. 이 페이지의 순서는 의미가 없다."),
    });
    storageId = page.id;
  }

  const sections = splitSections(gddMd ?? "");
  const overview = sections.find((s) => s.num === 1);
  const { pitch, sub, rows } = overviewFacts(overview?.body ?? "", projectName);

  // 앵커 = 볼드 피치 (매 발행 텍스트만 갱신)
  await api(cfg.token, "PATCH", `/blocks/${anchorId}`, {
    paragraph: { rich_text: rich(pitch ? `**"${pitch.replace(/^"|"$/g, "")}"**` : `**${projectName || projectId}**`) },
  });

  // ── 문서 목록 (분류 규칙은 webapp/src/lib/reports.ts reportKind와 동일 유지) ──
  const kindOf = (r) => {
    if (r.kind === "spec" || r.kind === "minutes" || r.kind === "report") return r.kind;
    const t = String(r.title ?? "");
    if (t.startsWith("회의록")) return "minutes";
    if (/명세서|규칙|스펙|사양/.test(t)) return "spec";
    return "report";
  };
  const all = (reports ?? []).slice(0, 20);
  const specList = all.filter((r) => kindOf(r) === "spec");
  const repList = all.filter((r) => kindOf(r) !== "spec");
  const fmtD = (ts) => new Date(ts).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
  const allDocs = [
    ...sections.map((s) => ({ key: `gdd:${s.num || s.title}`, group: "gdd", title: s.title, icon: s.icon, md: s.body })),
    ...specList.map((r) => ({ key: `spec:${r.ts}`, group: "spec", title: `${r.title} (${fmtD(r.ts)})`, icon: r.emoji || "📐", md: r.markdown ?? "" })),
    ...repList.map((r) => ({ key: `rep:${r.ts}`, group: "rep", title: `${r.title} (${fmtD(r.ts)})`, icon: r.emoji || "📋", md: r.markdown ?? "" })),
  ].map((d) => ({ ...d, hash: docHash(d) }));
  // 아트 발주서 → 아트 명세서의 하위 페이지 (오너 지시 2026-07-14)
  const artSpec = allDocs.find((d) => d.group === "spec" && /^아트 명세서/.test(d.title));
  for (const d of allDocs) {
    if (d.group === "spec" && /^아트 발주서/.test(d.title) && artSpec) d.parentKey = artSpec.key;
  }
  const docs = allDocs.filter((d) => !d.parentKey);
  const subDocs = allDocs.filter((d) => d.parentKey);

  // ── 문서 반영 — 해시 동일이면 무호출, 바뀐 것만 블록 교체, 새 것만 생성(보관함 아래) ──
  const newDocs = {};
  const pageIdOf = new Map();
  let reused = 0, updated = 0, created = 0;
  const upsertDoc = async (d, parentId) => {
    const prev = docsPrev[d.key];
    let id = prev?.id ?? null;
    if (id) {
      try {
        const p = await api(cfg.token, "GET", `/pages/${id}`);
        if (p.archived || p.in_trash) id = null;
      } catch {
        id = null;
      }
    }
    if (id && prev?.hash === d.hash) {
      reused++;
    } else if (id) {
      await api(cfg.token, "PATCH", `/pages/${id}`, {
        icon: { type: "emoji", emoji: d.icon },
        properties: { title: { title: rich(d.title) } },
      });
      const kids = await listChildren(cfg.token, id);
      // 하위 페이지(child_page)는 절대 지우지 않는다 — 발주서 등 문서 안에 사는 페이지 보존
      for (const k of kids) if (k.type !== "child_page") await deleteBlock(cfg.token, k.id);
      await appendBlocks(cfg.token, id, mdToBlocks(d.md));
      updated++;
    } else {
      const page = await createChildPage(cfg.token, parentId, d.title, d.icon, mdToBlocks(d.md));
      id = page.id;
      created++;
    }
    pageIdOf.set(d.key, id);
    newDocs[d.key] = { id, hash: d.hash };
  };
  for (const d of docs) await upsertDoc(d, storageId);
  for (const d of subDocs) {
    const pid = pageIdOf.get(d.parentKey);
    if (pid) await upsertDoc(d, pid);
  }
  // 사라진 문서 정리 — 이번 발행 목록에 없는 옛 페이지는 보관 처리
  for (const [k, v] of Object.entries(docsPrev)) {
    if (!newDocs[k] && v?.id) await deleteBlock(cfg.token, v.id);
  }

  // ── 허브 레이아웃 재구성 — "역순 삽입" (디자인 정본: docs/notion-design-guide.md)
  // 보관함(child_page)이 허브 맨 아래에 있으므로, 레이아웃 그룹을 "역순"으로 각각 after=앵커에 삽입한다.
  // 이유: column_list를 after=X로 넣을 때 X 뒤에 child_page 무리가 이어지면 노션이 무리 끝으로 밀어 넣는
  // quirk가 있다(2026-07-14 실측). 역순 삽입에서는 컬럼 삽입 시점의 다음 형제가 항상 일반 블록이라 안전하다.
  let children2 = await listChildren(cfg.token, rootId);
  for (const b of children2) if (b.id !== anchorId && b.type !== "child_page") await deleteBlock(cfg.token, b.id);

  const linkTo = (key) => (pageIdOf.has(key) ? { type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIdOf.get(key) } } : null);

  // 그룹 조립 (화면 순서대로 정의하고, 삽입은 아래에서 역순으로)
  const g1 = [];
  if (sub) g1.push({ type: "paragraph", paragraph: { rich_text: rich(sub) } });
  g1.push({ type: "divider", divider: {} }, heading2("🎮 게임 개요"));

  const coreLinks = [
    docs.find((d) => d.group === "gdd" && d.key === "gdd:1")?.key,
    artSpec?.key,
    docs.find((d) => d.group === "spec" && /^개발 명세서/.test(d.title))?.key,
    docs.find((d) => d.group === "spec" && /^개발 규칙/.test(d.title))?.key,
  ].filter(Boolean).map(linkTo).filter(Boolean);
  const g2cols = [
    [{
      type: "table",
      table: {
        table_width: 2,
        has_column_header: true,
        has_row_header: false,
        children: rows.map((r) => ({ type: "table_row", table_row: { cells: [rich(r[0]), rich(r[1])] } })),
      },
    }],
    [callout("⭐", rich("**핵심 문서 바로가기**"), "yellow_background", coreLinks)],
  ];

  const g3 = [{ type: "divider", divider: {} }, heading2("📄 기획서 모음")];

  const gddLinks = docs.filter((d) => d.group === "gdd").map((d) => linkTo(d.key)).filter(Boolean);
  const specLinks = docs.filter((d) => d.group === "spec").map((d) => linkTo(d.key)).filter(Boolean);
  if (subDocs.length > 0) {
    specLinks.push({ type: "paragraph", paragraph: { rich_text: rich(`└ 아트 발주서 ${subDocs.length}건은 아트 명세서 안(하위 페이지)`, { color: "gray" }) } });
  }
  const repLinks = docs.filter((d) => d.group === "rep").map((d) => linkTo(d.key)).filter(Boolean);
  const rightCol = [];
  if (specLinks.length > 0) rightCol.push(callout("📐", rich("**명세서 — 팀 배포 기준 문서**"), "blue_background", specLinks));
  if (repLinks.length > 0) rightCol.push(callout("🗂️", rich("**보고서함 — 회의록·검증 보고**"), "gray_background", repLinks));
  const g4cols = [
    [callout("📄", rich("**마스터 GDD — 섹션별 기획서**"), "default", gddLinks)],
    rightCol.length > 0 ? rightCol : [{ type: "paragraph", paragraph: { rich_text: rich("") } }],
  ];

  // 아트(맨 아래 칸 — 오너 지시) + 발행 시각 꼬리
  const g5 = [];
  const kvs = (keyVisuals ?? []).filter((k) => k?.path && fs.existsSync(k.path));
  if (kvs.length > 0) {
    g5.push({ type: "divider", divider: {} }, heading2("🖼️ 아트 — 키비주얼·아이콘"));
    for (const k of kvs) {
      try {
        const fid = await uploadImageToNotion(cfg.token, k.path, path.basename(k.path));
        g5.push({
          type: "image",
          image: { type: "file_upload", file_upload: { id: fid }, caption: rich(k.caption ?? path.basename(k.path)) },
        });
      } catch (e) {
        console.warn(`[notion] 키비주얼 업로드 생략(${path.basename(k.path)}):`, e?.message ?? e);
      }
    }
  }
  g5.push({ type: "paragraph", paragraph: { rich_text: rich(`🔄 Vision Engine 자동 발행 — 마지막: ${new Date().toLocaleString("ko-KR", { hour12: false })}`, { color: "gray" }) } });

  // 역순 삽입 — 전부 after=앵커: 마지막에 넣은 그룹이 맨 위로 온다
  await appendBlocks(cfg.token, rootId, g5, anchorId);
  await appendColumnList(cfg.token, rootId, g4cols, anchorId);
  await appendBlocks(cfg.token, rootId, g3, anchorId);
  await appendColumnList(cfg.token, rootId, g2cols, anchorId);
  await appendBlocks(cfg.token, rootId, g1, anchorId);

  map[projectId] = { rootPageId: rootId, anchorId, storageId, docs: newDocs, lastPublish: Date.now() };
  saveMap(map);
  const dash = rootId.replace(/-/g, "");
  console.log(`[notion] 발행 — 재사용 ${reused} · 갱신 ${updated} · 신규 ${created} (휴지통행 0 목표)`);
  return { ok: true, pageId: rootId, url: `https://www.notion.so/${dash}`, reused, updated, created };
}

/* ── 노션 편집실 — 임의 페이지 읽기(블록→마크다운) + 안전 수정 ──
 * "링크를 주면 분석해서 내 요구대로 고쳐줘" 흐름의 서버측.
 *   fetchPageAsMd  : 페이지를 마크다운으로 역변환 (지원 안 되는 블록은 보존 마커로)
 *   updatePageContent : 수정안 반영 — 하위 페이지·DB 등 복합 블록은 절대 삭제하지 않고,
 *                       반영 전 원본을 config/notion-edits/에 백업한다.
 */

const EDIT_BACKUP_DIR = path.resolve(__dirname, "..", "..", "config", "notion-edits");

/** 안전하게 삭제·재작성할 수 있는 블록 타입 (텍스트 계열) */
const SAFE_TYPES = new Set([
  "paragraph", "heading_1", "heading_2", "heading_3",
  "bulleted_list_item", "numbered_list_item", "to_do", "quote",
  "divider", "code", "callout", "toggle", "table", "table_row", "image",
]);

/** rich_text 배열 → 인라인 마크다운 */
function richToMd(rt) {
  return (rt ?? [])
    .map((t) => {
      let s = t?.plain_text ?? "";
      if (!s) return "";
      const a = t?.annotations ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      else if (a.italic) s = `*${s}*`;
      const href = t?.href;
      if (href) s = `[${s}](${href})`;
      return s;
    })
    .join("");
}

/** 블록의 자식들을 전부 나열 (페이지네이션) */
async function listChildren(token, blockId) {
  const out = [];
  let cursor;
  do {
    const r = await api(token, "GET", `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    out.push(...(r.results ?? []));
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor && out.length < 400);
  return out;
}

/** 블록 1개 → 마크다운 줄들 (지원 안 되는 타입은 보존 마커)
 * opts.flatten : 컬럼 등 레이아웃 블록을 투과해 내용을 읽는다 (가져오기 전용 — 편집실은 마커 유지)
 * opts.pages   : 배열이면 하위 페이지·페이지 링크를 수집한다 (딥 리드에서 본문을 이어 읽기 위해)
 */
async function blockToMd(token, b, depth, notes, budget, opts = {}) {
  const ind = "  ".repeat(depth);
  const t = b.type;
  const d = b[t] ?? {};
  const text = richToMd(d.rich_text);
  const lines = [];
  const child = async () => {
    // 허브 페이지는 column_list→column→callout→page 4단 중첩이 흔해 flatten은 더 깊이 내려간다
    const maxDepth = opts.flatten ? 4 : 2;
    if (!b.has_children || depth >= maxDepth || budget.calls <= 0) return [];
    budget.calls--;
    const kids = await listChildren(token, b.id);
    const out = [];
    for (const k of kids) out.push(...(await blockToMd(token, k, depth + 1, notes, budget, opts)));
    return out;
  };
  switch (t) {
    case "paragraph":
      if (text) lines.push(ind + text);
      break;
    case "heading_1":
      lines.push(`# ${text}`);
      break;
    case "heading_2":
      lines.push(`## ${text}`);
      break;
    case "heading_3":
      lines.push(`### ${text}`);
      break;
    case "heading_4":
    case "heading_5":
    case "heading_6":
      // 노션 신형 API의 심화 헤딩 — 가져오기에서만 텍스트로 살린다 (편집실은 마커 보존 유지)
      if (opts.flatten) lines.push(`#### ${text}`);
      else {
        lines.push(`[[유지: ${t} 블록]]`);
        notes.add(`${t} 블록은 수정 대상에서 제외되고 보존됩니다`);
      }
      break;
    case "bulleted_list_item":
      lines.push(`${ind}- ${text}`);
      lines.push(...(await child()));
      break;
    case "numbered_list_item":
      lines.push(`${ind}1. ${text}`);
      lines.push(...(await child()));
      break;
    case "to_do":
      lines.push(`${ind}- [${d.checked ? "x" : " "}] ${text}`);
      break;
    case "quote":
      lines.push(`${ind}> ${text}`);
      break;
    case "divider":
      lines.push("---");
      break;
    case "code":
      lines.push("```" + (d.language ?? ""), richToMd(d.rich_text), "```");
      break;
    case "callout": {
      const icon = d.icon?.emoji ?? "💡";
      lines.push(`> ${icon} ${text}`); // 콜아웃은 인용으로 강등 (재작성 시 인용이 됨)
      notes.add("콜아웃은 인용문으로 단순화되어 읽힙니다");
      lines.push(...(await child()));
      break;
    }
    case "toggle":
      lines.push(`${ind}- **${text}**`);
      lines.push(...(await child()));
      notes.add("토글은 불릿으로 단순화되어 읽힙니다");
      break;
    case "table": {
      if (budget.calls > 0) {
        budget.calls--;
        const rows = await listChildren(token, b.id);
        rows.forEach((row, i) => {
          const cells = (row.table_row?.cells ?? []).map((c) => richToMd(c).replace(/\|/g, "\\|"));
          lines.push(`| ${cells.join(" | ")} |`);
          if (i === 0) lines.push(`|${cells.map(() => "---").join("|")}|`);
        });
      }
      break;
    }
    case "image": {
      const url = d.external?.url;
      if (url) lines.push(`![이미지](${url})`);
      else if (opts.flatten) notes.add("업로드된 이미지는 가져오기에서 생략됩니다");
      else {
        lines.push(`[[유지: 업로드 이미지]]`);
        notes.add("업로드된 이미지는 수정 시 원래 자리(상단)에 보존됩니다");
      }
      break;
    }
    case "column_list":
    case "column":
    case "synced_block":
      if (opts.flatten) {
        lines.push(...(await child())); // 레이아웃 블록은 투과 — 내용만 읽는다
      } else {
        lines.push(`[[유지: ${t} 블록]]`);
        notes.add(`${t} 블록은 수정 대상에서 제외되고 보존됩니다`);
      }
      break;
    case "child_page":
      if (opts.pages) {
        opts.pages.push({ id: b.id, title: d.title ?? "" });
        lines.push(`${ind}- 📄 하위 기획서 「${d.title ?? ""}」 (본문은 아래에 수록)`);
      } else if (opts.flatten) {
        lines.push(`${ind}- 📄 하위 페이지 「${d.title ?? ""}」`);
      } else {
        lines.push(`[[유지: 하위 페이지 「${d.title ?? ""}」]]`);
      }
      break;
    case "link_to_page": {
      const pid = d.page_id;
      if (opts.pages && pid) {
        opts.pages.push({ id: pid, title: null });
        lines.push(`${ind}- 📄 연결된 기획서 (본문은 아래에 수록)`);
      } else if (opts.flatten) {
        lines.push(`${ind}- 📄 연결된 페이지`);
      } else {
        lines.push(`[[유지: ${t} 블록]]`);
        notes.add(`${t} 블록은 수정 대상에서 제외되고 보존됩니다`);
      }
      break;
    }
    case "child_database":
      if (opts.flatten) lines.push(`${ind}- 🗃️ 데이터베이스 「${d.title ?? ""}」`);
      else lines.push(`[[유지: 데이터베이스 「${d.title ?? ""}」]]`);
      break;
    default:
      if (opts.flatten) {
        notes.add(`${t} 블록은 가져오기에서 생략됩니다`);
      } else {
        lines.push(`[[유지: ${t} 블록]]`);
        notes.add(`${t} 블록은 수정 대상에서 제외되고 보존됩니다`);
      }
  }
  return lines;
}

/** 페이지 제목 읽기 */
async function pageTitle(token, pageId) {
  const page = await api(token, "GET", `/pages/${pageId}`);
  for (const v of Object.values(page?.properties ?? {})) {
    if (v?.type === "title") return (v.title ?? []).map((x) => x?.plain_text ?? "").join("") || "(제목 없음)";
  }
  return "(제목 없음)";
}

/** 노션 페이지 → 마크다운 (편집실 읽기 단계) */
export async function fetchPageAsMd(pageUrlOrId) {
  const cfg = loadCfg();
  if (!cfg.token) throw new Error("노션 연동이 설정되지 않았습니다 — 📚 노션 연동에서 토큰을 먼저 등록하세요");
  const pageId = parsePageId(pageUrlOrId);
  if (!pageId) throw new Error("링크에서 페이지 id를 찾지 못했습니다");
  const title = await pageTitle(cfg.token, pageId);
  const blocks = await listChildren(cfg.token, pageId);
  const notes = new Set();
  const budget = { calls: 30 }; // 중첩 블록 추가 조회 상한 (깊은 페이지 폭주 방지)
  const md = [];
  let complexCount = 0;
  for (const b of blocks) {
    if (!SAFE_TYPES.has(b.type)) complexCount++;
    md.push(...(await blockToMd(cfg.token, b, 0, notes, budget)));
  }
  return {
    pageId,
    title,
    md: md.join("\n"),
    blockCount: blocks.length,
    complexCount,
    notes: [...notes],
    url: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
  };
}

/**
 * 노션 페이지 딥 리드 — "기존 기획을 노션으로 시작"용.
 * 허브 페이지는 컬럼·콜아웃 안에 내용과 하위 기획서 링크가 있으므로,
 * 레이아웃 블록을 투과해 읽고(flatten) 하위 페이지·페이지 링크를 1단계 따라가 본문을 이어붙인다.
 */
export async function fetchPageDeepAsMd(pageUrlOrId, maxPages = 20, onProgress) {
  const cfg = loadCfg();
  if (!cfg.token) throw new Error("노션 연동이 설정되지 않았습니다 — 📚 노션 연동에서 토큰을 먼저 등록하세요");
  const rootId = parsePageId(pageUrlOrId);
  if (!rootId) throw new Error("링크에서 페이지 id를 찾지 못했습니다");
  const notes = new Set();
  const SUB_MD_CAP = 8000; // 하위 기획서 1개당 분량 상한 (전체 폭주 방지)

  const readOne = async (pageId, collect) => {
    const title = await pageTitle(cfg.token, pageId);
    const blocks = await listChildren(cfg.token, pageId);
    const budget = { calls: 80 }; // 딥 리드는 컬럼 투과 때문에 여유 있게
    const md = [];
    for (const b of blocks) md.push(...(await blockToMd(cfg.token, b, 0, notes, budget, { flatten: true, pages: collect })));
    return { title, md: md.join("\n") };
  };

  const collected = [];
  onProgress?.({ done: 0, total: 1, title: "허브 페이지 읽는 중" });
  const root = await readOne(rootId, collected);
  const parts = [`# ${root.title}`, "", root.md];
  // 중복 제거 후 상한 적용 — 진행률(total)을 먼저 확정해 UI에 알린다
  const seen = new Set([rootId.replace(/-/g, "")]);
  const unique = [];
  for (const p of collected) {
    const norm = String(p.id ?? "").replace(/-/g, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(p);
  }
  if (unique.length > maxPages) notes.add(`하위 페이지가 많아 ${maxPages}개까지만 읽었습니다`);
  const queue = unique.slice(0, maxPages);
  const total = queue.length + 1;
  onProgress?.({ done: 1, total, title: root.title });
  let count = 0; // 성공적으로 수록한 하위 페이지 수
  let done = 1; // 진행률 (허브 포함)
  for (const p of queue) {
    try {
      const sub = await readOne(p.id, null); // 하위의 하위까지는 내려가지 않는다 (1단계)
      let body = sub.md;
      if (body.length > SUB_MD_CAP) {
        body = body.slice(0, SUB_MD_CAP) + "\n\n_(…분량이 길어 뒷부분 생략)_";
        notes.add(`「${sub.title}」은 분량이 길어 앞 ${Math.round(SUB_MD_CAP / 1000)}천자만 수록했습니다`);
      }
      parts.push("", "---", "", `## 📄 ${sub.title}`, "", body);
      count++;
      done++;
      onProgress?.({ done, total, title: sub.title });
    } catch {
      done++;
      onProgress?.({ done, total, title: p.title ?? "" });
      notes.add(`하위 페이지 「${p.title ?? p.id}」 읽기 실패 — 통합(Connections) 연결을 확인하세요`);
    }
  }
  return {
    pageId: rootId,
    title: root.title,
    md: parts.join("\n"),
    pages: count + 1,
    notes: [...notes],
    url: `https://www.notion.so/${rootId.replace(/-/g, "")}`,
  };
}

/**
 * 편집실 — 임의 페이지 아래 새 하위 기획서 페이지 생성 (오너 스타일: 이모지 아이콘 + 본문).
 * 기존 페이지는 일절 건드리지 않으므로 가장 안전한 반영 방식이다.
 */
export async function createSubpage(parentUrlOrId, title, markdown, icon = "📄") {
  const cfg = loadCfg();
  if (!cfg.token) throw new Error("노션 연동이 설정되지 않았습니다");
  let parentId = parsePageId(parentUrlOrId);
  if (!parentId) throw new Error("링크에서 페이지 id를 찾지 못했습니다");
  if (!String(title ?? "").trim()) throw new Error("하위 페이지 제목이 비어 있습니다");
  // 허브 홈잉 — 허브 직속으로 만들면 페이지 바닥에 쌓여 기존 기획서와 동떨어져 보인다.
  // config.subpageHome이 설정돼 있으면: 실제 생성은 home.parent(VE 작업실) 아래,
  // 노출은 home.linkCallout("작업 중인 기획서" 콜아웃)에 link_to_page로 — 오너 정리 방식과 일치.
  const home = cfg.subpageHome ?? {};
  let linkCalloutId = "";
  if (home.parent && parentId === parsePageId(String(home.hub ?? ""))) {
    parentId = parsePageId(String(home.parent));
    linkCalloutId = parsePageId(String(home.linkCallout ?? ""));
  }
  const clean = String(markdown ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\[\[유지:.*\]\]\s*$/.test(l))
    .join("\n");
  const page = await createChildPage(cfg.token, parentId, title.trim(), icon, mdToBlocks(clean));
  if (linkCalloutId) {
    try {
      await api(cfg.token, "PATCH", `/blocks/${linkCalloutId}/children`, {
        children: [{ object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: page.id } }],
      });
    } catch {
      /* 링크 추가 실패는 페이지 생성 자체를 막지 않는다 */
    }
  }
  return { ok: true, pageId: page.id, homed: !!linkCalloutId, url: `https://www.notion.so/${String(page.id).replace(/-/g, "")}` };
}

/**
 * 수정안 반영 — mode "replace"는 텍스트 계열 블록만 지우고(복합 블록 보존) 새 내용을 붙인다.
 * mode "append"는 기존 내용 아래에 덧붙이기만 한다. 반영 전 원본 마크다운을 백업한다.
 */
export async function updatePageContent(pageUrlOrId, markdown, mode = "replace") {
  const cfg = loadCfg();
  if (!cfg.token) throw new Error("노션 연동이 설정되지 않았습니다");
  const pageId = parsePageId(pageUrlOrId);
  if (!pageId) throw new Error("링크에서 페이지 id를 찾지 못했습니다");

  // ① 원본 백업 (실수해도 되돌릴 수 있게)
  const before = await fetchPageAsMd(pageId);
  fs.mkdirSync(EDIT_BACKUP_DIR, { recursive: true });
  const backupFile = path.join(EDIT_BACKUP_DIR, `${pageId.replace(/-/g, "")}-${Date.now()}.md`);
  fs.writeFileSync(backupFile, `# [백업] ${before.title}\n\n${before.md}\n`, "utf-8");

  let preserved = 0;
  if (mode === "replace") {
    // ② 텍스트 계열만 삭제 — 하위 페이지·DB·임베드 등은 절대 지우지 않는다
    const blocks = await listChildren(cfg.token, pageId);
    for (const b of blocks) {
      if (SAFE_TYPES.has(b.type) && !(b.type === "image" && !b.image?.external)) {
        try {
          await api(cfg.token, "DELETE", `/blocks/${b.id}`);
        } catch {
          /* 개별 삭제 실패는 무시 */
        }
      } else {
        preserved++;
      }
    }
  }

  // ③ 수정안에서 보존 마커([[유지: …]])는 실블록이 남아 있으므로 제거하고 작성
  const clean = String(markdown ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\[\[유지:.*\]\]\s*$/.test(l))
    .join("\n");
  await appendBlocks(cfg.token, pageId, mdToBlocks(clean));

  return {
    ok: true,
    pageId,
    url: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
    preserved,
    backup: path.basename(backupFile),
  };
}

/* ── 자동 발행 큐 (디바운스) — GDD/보고서 저장 훅에서 호출 ── */

const pending = new Map(); // projectId → timeout
let publishing = false;

export function queueAutoPublish(projectId, getPayload) {
  const cfg = loadCfg();
  if (!cfg.token || !cfg.parentPageId || !cfg.auto) return;
  clearTimeout(pending.get(projectId));
  pending.set(
    projectId,
    setTimeout(() => {
      void (async () => {
        if (publishing) {
          queueAutoPublish(projectId, getPayload); // 진행 중이면 뒤로 미룸
          return;
        }
        publishing = true;
        try {
          const payload = await getPayload();
          await publishProject(payload);
          console.log(`[notion] 자동 발행 완료 — ${payload.projectName ?? projectId}`);
        } catch (e) {
          console.warn(`[notion] 자동 발행 실패: ${String(e?.message ?? e).slice(0, 160)}`);
        } finally {
          publishing = false;
        }
      })();
    }, 90_000) // 회의가 연쇄 저장하는 동안 기다렸다 한 번에
  );
}

export function lastPublishInfo(projectId) {
  const m = loadMap()[projectId];
  if (!m?.rootPageId) return null;
  return { url: `https://www.notion.so/${m.rootPageId.replace(/-/g, "")}`, ts: m.lastPublish ?? 0 };
}
