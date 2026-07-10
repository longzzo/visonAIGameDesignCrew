// 노션 발행 — 마스터 GDD·보고서를 오너의 노션 워크스페이스에 아카이브한다.
// 디자인은 오너의 레퍼런스 페이지("최슬왕"/"슬라임 김치" 대시보드)를 따른다:
//   허브 페이지 = 볼드 피치 → 구분선 → 게임 개요 표(파란 헤딩) → 기획서 콜아웃 → 섹션별 자식 페이지.
// 토큰은 config/notion.json (커밋 금지 — .gitignore) 에 저장. Notion 내부 통합(Internal Integration) 토큰 사용.

import fs from "node:fs";
import path from "node:path";
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

/** 마크다운 본문 → 노션 블록 배열 (헤딩/불릿/번호/인용/코드/표/구분선/이미지) */
export function mdToBlocks(md) {
  const blocks = [];
  const lines = String(md ?? "").split(/\r?\n/);
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
        code: { rich_text: rich(buf.join("\n").slice(0, 1900)), language: fence[1] || "plain text" },
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

/** 개요 섹션에서 대시보드 표 데이터 추출 — "**항목**: 값" 라인들 */
function overviewFacts(overviewBody, projectName) {
  const rows = [["항목", "내용"], ["가제", projectName || "(프로젝트명 미정)"]];
  const grab = (label) => {
    const m = new RegExp(`\\*\\*${label}[^*]*\\*\\*\\s*[:：]\\s*(.+)`).exec(overviewBody);
    return m ? m[1].replace(/\s+$/, "").trim() : "";
  };
  const pitch = grab("한 줄 피치");
  const gpt = grab("장르/플랫폼/타깃") || grab("장르");
  if (gpt) {
    const parts = gpt.split("—");
    rows.push(["장르/플랫폼", parts[0].trim()]);
    if (parts[1]) rows.push(["타겟 유저", parts[1].trim()]);
  }
  if (pitch) rows.push(["로그라인", pitch]);
  return { pitch, rows };
}

/* ── 발행 ──────────────────────────────────────────── */

async function appendBlocks(token, blockId, blocks) {
  for (let i = 0; i < blocks.length; i += 90) {
    await api(token, "PATCH", `/blocks/${blockId}/children`, { children: blocks.slice(i, i + 90) });
  }
}

async function clearChildren(token, blockId) {
  let cursor;
  const ids = [];
  do {
    const r = await api(token, "GET", `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of r.results ?? []) ids.push(b.id);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  for (const id of ids) {
    try {
      await api(token, "DELETE", `/blocks/${id}`);
    } catch {
      /* 이미 지워진 블록 등은 무시 */
    }
  }
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

const callout = (emoji, richText, color = "blue_background") => ({
  type: "callout",
  callout: { icon: { type: "emoji", emoji }, rich_text: richText, color },
});
const heading2 = (text, color = "blue") => ({ type: "heading_2", heading_2: { rich_text: rich(text), color } });

/**
 * 프로젝트 전체 발행 — 허브 페이지(레퍼런스 대시보드 스타일) + GDD 섹션 자식 페이지 + 보고서 자식 페이지.
 * 허브 URL은 유지되고 내용·자식만 교체된다.
 */
export async function publishProject({ projectId, projectName, gddMd, reports }) {
  const cfg = loadCfg();
  if (!cfg.token || !cfg.parentPageId) throw new Error("노션 연동이 설정되지 않았습니다 — 토큰과 부모 페이지를 먼저 등록하세요");
  const map = loadMap();
  let rootId = map[projectId]?.rootPageId;

  // 허브 페이지 확보 (없거나 삭제됐으면 생성)
  const title = `🎮 ${projectName || projectId}`;
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
  } else {
    await api(cfg.token, "PATCH", `/pages/${rootId}`, { properties: { title: { title: rich(projectName || projectId) } } });
  }

  // 기존 내용·자식 페이지 정리 후 재구성 (허브 URL은 유지)
  await clearChildren(cfg.token, rootId);

  const sections = splitSections(gddMd ?? "");
  const overview = sections.find((s) => s.num === 1);
  const { pitch, rows } = overviewFacts(overview?.body ?? "", projectName);

  // ① 허브 헤더 — 볼드 피치 + 개요 표 (레퍼런스 스타일)
  const header = [];
  if (pitch) header.push({ type: "paragraph", paragraph: { rich_text: rich(`**"${pitch.replace(/^"|"$/g, "")}"**`) } });
  header.push({ type: "divider", divider: {} });
  header.push(heading2("🎮 게임 개요"));
  header.push({
    type: "table",
    table: {
      table_width: 2,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((r) => ({ type: "table_row", table_row: { cells: [rich(r[0]), rich(r[1])] } })),
    },
  });
  header.push({ type: "divider", divider: {} });
  header.push(heading2("📄 마스터 GDD — 섹션별 기획서"));
  header.push(
    callout("📌", rich(`**자동 발행 문서** — Vision Engine 스튜디오가 회의 결과를 이 페이지 트리로 발행합니다. 마지막 발행: ${new Date().toLocaleString("ko-KR", { hour12: false })}`), "yellow_background")
  );
  await appendBlocks(cfg.token, rootId, header);

  // ② GDD 섹션 자식 페이지 (순서대로 → 허브에 순서대로 나열됨)
  for (const s of sections) {
    await createChildPage(cfg.token, rootId, s.title, s.icon, mdToBlocks(s.body));
  }

  // ③ 보고서함
  const reps = (reports ?? []).slice(0, 20);
  if (reps.length > 0) {
    await appendBlocks(cfg.token, rootId, [
      { type: "divider", divider: {} },
      heading2("📋 보고서함"),
      callout("🗂️", rich(`최근 보고서 ${reps.length}건 — 회의록·명세서·협업 결론`), "gray_background"),
    ]);
    for (const r of reps) {
      const d = new Date(r.ts).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      await createChildPage(cfg.token, rootId, `${r.title} (${d})`, r.emoji || "📋", mdToBlocks(r.markdown ?? ""));
    }
  }

  map[projectId] = { rootPageId: rootId, lastPublish: Date.now() };
  saveMap(map);
  const dash = rootId.replace(/-/g, "");
  return { ok: true, pageId: rootId, url: `https://www.notion.so/${dash}` };
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

/** 블록 1개 → 마크다운 줄들 (지원 안 되는 타입은 보존 마커) */
async function blockToMd(token, b, depth, notes, budget) {
  const ind = "  ".repeat(depth);
  const t = b.type;
  const d = b[t] ?? {};
  const text = richToMd(d.rich_text);
  const lines = [];
  const child = async () => {
    if (!b.has_children || depth >= 2 || budget.calls <= 0) return [];
    budget.calls--;
    const kids = await listChildren(token, b.id);
    const out = [];
    for (const k of kids) out.push(...(await blockToMd(token, k, depth + 1, notes, budget)));
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
      else {
        lines.push(`[[유지: 업로드 이미지]]`);
        notes.add("업로드된 이미지는 수정 시 원래 자리(상단)에 보존됩니다");
      }
      break;
    }
    case "child_page":
      lines.push(`[[유지: 하위 페이지 「${d.title ?? ""}」]]`);
      break;
    case "child_database":
      lines.push(`[[유지: 데이터베이스 「${d.title ?? ""}」]]`);
      break;
    default:
      lines.push(`[[유지: ${t} 블록]]`);
      notes.add(`${t} 블록은 수정 대상에서 제외되고 보존됩니다`);
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
