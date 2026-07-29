// 마스터 GDD 마크다운 섹션 조작 + 로컬 API(/api/gdd, /api/projects) 입출력

export interface GddState {
  markdown: string;
  mtime: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: number;
  mtime: number;
  /** 마지막으로 선택한 시각(서버 기록) — 세션 복원의 기준. 0이면 연 적 없음. */
  lastOpenedAt?: number;
}

/**
 * 프로젝트 선택을 서버에 기록한다.
 * localStorage만으로는 데스크톱 앱↔브라우저 사이에서 선택이 유실돼 목록 첫 항목
 * ("첫 테스트")으로 되돌아갔다 — 다른 프로젝트에 회의가 붙는 사고 직전까지 갔다(C-2).
 */
export async function touchProject(id: string): Promise<void> {
  try {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch: id }),
    });
  } catch {
    /* 기록 실패는 무시 */
  }
}

/* ── 프로젝트 CRUD ─────────────────────────────────── */

export async function listProjects(): Promise<ProjectInfo[]> {
  const r = await fetch("/api/projects");
  if (!r.ok) throw new Error(`프로젝트 목록 실패 (${r.status})`);
  const j = await r.json();
  return (j.projects ?? []) as ProjectInfo[];
}

export async function createProject(name: string): Promise<string> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "프로젝트 생성 실패");
  return j.id as string;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "이름 변경 실패");
}

export async function deleteProject(id: string): Promise<void> {
  const r = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "프로젝트 삭제 실패");
}

/* ── GDD 읽기/쓰기 (프로젝트별) ─────────────────────── */

export async function fetchGdd(project: string): Promise<GddState> {
  const r = await fetch(`/api/gdd?project=${encodeURIComponent(project)}`);
  if (!r.ok) throw new Error(`GDD 읽기 실패 (${r.status})`);
  return (await r.json()) as GddState;
}

export async function saveGdd(project: string, markdown: string): Promise<number> {
  const r = await fetch(`/api/gdd?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `GDD 저장 실패 (${r.status})`);
  return j.mtime as number;
}

/* ── GDD 버전 히스토리 ─────────────────────────────── */

export interface GddVersion {
  ts: number;
  size: number;
}

export async function listGddVersions(project: string): Promise<GddVersion[]> {
  const r = await fetch(`/api/gdd/history?project=${encodeURIComponent(project)}`);
  if (!r.ok) return [];
  return (await r.json()).versions ?? [];
}

export async function fetchGddVersion(project: string, ts: number): Promise<string> {
  const r = await fetch(`/api/gdd/history?project=${encodeURIComponent(project)}&ts=${ts}`);
  if (!r.ok) throw new Error("버전 조회 실패");
  return (await r.json()).markdown ?? "";
}

export async function restoreGddVersion(project: string, ts: number): Promise<{ markdown: string; mtime: number }> {
  const r = await fetch(`/api/gdd/restore?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "복원 실패");
  return { markdown: j.markdown, mtime: j.mtime };
}

/* ── 채팅/피드 영속화 ──────────────────────────────── */

export async function loadChatHistory(project: string, agent: string): Promise<any[]> {
  try {
    const r = await fetch(`/api/chats?project=${encodeURIComponent(project)}&agent=${encodeURIComponent(agent)}`);
    if (!r.ok) return [];
    return (await r.json()).messages ?? [];
  } catch {
    return [];
  }
}

export async function saveChatHistory(project: string, agent: string, messages: any[]): Promise<void> {
  try {
    await fetch(`/api/chats?project=${encodeURIComponent(project)}&agent=${encodeURIComponent(agent)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch {
    /* 로컬 저장 실패는 치명적이지 않음 */
  }
}

export async function loadFeedHistory(project: string): Promise<any[]> {
  try {
    const r = await fetch(`/api/feed?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).feed ?? [];
  } catch {
    return [];
  }
}

export async function saveFeedHistory(project: string, feed: any[]): Promise<void> {
  try {
    await fetch(`/api/feed?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed }),
    });
  } catch {
    /* noop */
  }
}

/* ── 3D 사무실 실황 릴레이 (탭 간 회의 상태 공유) ── */

export async function publishLive(project: string, data: unknown): Promise<void> {
  try {
    await fetch(`/api/live?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
  } catch {
    /* noop */
  }
}

export async function fetchLive(project: string): Promise<any | null> {
  try {
    const r = await fetch(`/api/live?project=${encodeURIComponent(project)}`);
    if (!r.ok) return null;
    return (await r.json()).live ?? null;
  } catch {
    return null;
  }
}

/* ── 마크다운 섹션 조작 ─────────────────────────────── */

/** headingPrefix 섹션의 본문 텍스트만 추출 (없거나 미작성 플레이스홀더면 빈 문자열) */
export function getSectionBody(markdown: string, headingPrefix: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimStart().startsWith(headingPrefix));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  return /아직 작성되지 않음/.test(body) ? "" : body;
}

/* ── Brave 검색 키 등록 ─────────────────────────────── */

export async function getBraveKeyStatus(): Promise<boolean> {
  try {
    const r = await fetch("/api/brave-key");
    return (await r.json()).configured === true;
  } catch {
    return false;
  }
}

export async function setBraveKey(key: string): Promise<void> {
  const r = await fetch("/api/brave-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "키 저장 실패");
}

/**
 * headingPrefix(예: "## 3.")로 시작하는 섹션의 본문을 newBody로 교체한다.
 * 섹션이 없으면 문서 끝에 추가한다. 헤딩 라인 자체는 보존한다.
 */
export function replaceSection(
  markdown: string,
  headingPrefix: string,
  fallbackTitle: string,
  newBody: string
): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimStart().startsWith(headingPrefix));
  const body = newBody.trim();
  if (start === -1) {
    return `${markdown.trimEnd()}\n\n${headingPrefix} ${fallbackTitle}\n\n${body}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}\n\n${body}\n${after ? "\n" + after : ""}`;
}

/* ── 리플로우 — 개행이 유실된(한 줄로 뭉친) 마크다운을 구조로 복원 ──
 * 일부 모델이 섹션 전체를 한 줄로 뱉는다. 그대로 두면 앱·노션 모두 벽글이 되고
 * 표가 문자로 보인다. 서버(notion-publish.mjs reflowMd)와 같은 알고리즘 — 수정 시 함께.
 */

/** 한 줄에 인라인으로 뭉친 파이프 표를 행 단위 표로 복원 */
function unflattenTableLine(line: string): string[] | null {
  if (!/\|\s*:?-{2,}/.test(line)) return null;
  if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) return null; // 이미 정상 구분자 줄
  const first = line.indexOf("|");
  const last = line.lastIndexOf("|");
  if (first < 0 || last <= first) return null;
  const before = line.slice(0, first).trim();
  const after = line.slice(last + 1).trim();
  const tokens = line
    .slice(first + 1, last)
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c !== "");
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
  const pre = tokens.slice(0, sepStart - cols).join(" ").trim();
  const body = tokens.slice(sepStart + sepLen);
  const outLines: string[] = [];
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
export function reflowMd(md: string): string {
  const out: string[] = [];
  for (const rawLine of String(md ?? "").split(/\r?\n/)) {
    const pieces = rawLine.split(/\s+(?=#{2,4}\s)/);
    for (let piece of pieces) {
      const tbl = unflattenTableLine(piece);
      if (tbl) {
        for (const l of tbl) {
          if (/^\|/.test(l) || l === "") out.push(l);
          else out.push(...reflowMd(l).split("\n"));
        }
        continue;
      }
      const numHits = piece.match(/\s\*{0,2}\d{1,2}[.)]\s+(?=\*\*|[가-힣A-Za-z"'『「(\[])/g);
      const startsWithItem = /^\s*\*{0,2}\d{1,2}[.)]\s/.test(piece);
      if (numHits && numHits.length + (startsWithItem ? 1 : 0) >= 2) {
        piece = piece.replace(/\s(\*{0,2}\d{1,2}[.)]\s+)(?=\*\*|[가-힣A-Za-z"'『「(\[])/g, "\n$1");
      }
      const bulHits = piece.match(/[^\d\s]\s+-\s+\S/g);
      if (bulHits && bulHits.length >= 2) {
        piece = piece.replace(/([^\d\s])\s+-\s+(?=\S)/g, "$1\n- ");
      }
      out.push(...piece.split("\n"));
    }
  }
  return out.join("\n");
}

/**
 * 다른 언어 누수 감지 — 모델(122b/80b)이 한국어 산출물에 러시아어·중국어·일본어를 흘린다.
 * 실사례: 브리핑 "всю HUD"·"9일以有", 결정 원장 "结算/锁定", 회고 "zasady".
 *
 * 프롬프트 규칙(KO_RULE)이 1차 방어지만 모델은 여전히 흘린다 — 이건 2차 방어로,
 * **지우지 않고 알리기만 한다**(자동 삭제는 정상 내용까지 깰 수 있다. 판단은 오너·메인 헤드 몫).
 * 한자는 한국어 문서에도 드물게 정상 등장하므로 2자 이상일 때만 잡는다.
 */
export function detectLangLeak(text: string): string {
  if (!text) return "";
  const hits: string[] = [];
  const cyr = text.match(/[Ѐ-ӿ]+/g);
  const kana = text.match(/[぀-ヿ]+/g);
  const han = text.match(/[一-鿿]+/g);
  // 한글에 한자가 **바로 붙은** 토큰은 길이와 무관하게 누수다: "실装", "도点", "초반十章".
  // 처음엔 "한자 2자 이상"만 봤는데, 1자짜리가 한글에 박힌 실제 누수를 놓쳤다(2026-07-16 실측).
  const glued = text.match(/[가-힣][一-鿿]+|[一-鿿]+[가-힣]/g);
  // 한글 바로 뒤 로마자 3자 이상 — "만dropping", "진URITY" 류 결합 쓰레기 (단, "HUD를" 같은 정상 조사는 걸리지 않는다)
  const mixLatin = text.match(/[가-힣][A-Za-z]{3,}/g);
  if (cyr) hits.push(`러시아어 ${[...new Set(cyr)].slice(0, 3).join(",")}`);
  if (kana) hits.push(`일본어 ${[...new Set(kana)].slice(0, 3).join(",")}`);
  if (glued) hits.push(`한글+한자 ${[...new Set(glued)].slice(0, 3).join(",")}`);
  else if (han && han.join("").length >= 2) hits.push(`한자 ${[...new Set(han)].slice(0, 3).join(",")}`);
  if (mixLatin) hits.push(`한글+로마자 ${[...new Set(mixLatin)].slice(0, 3).join(",")}`);
  return hits.join(" · ");
}

/** 게이트웨이 오류 문자열 감지 — 이게 산출물로 저장되면 GDD·회의가 오염된다 (2026-07-11 실측: 타임아웃 문구가 GDD 섹션에 반영됨) */
/**
 * 재시도해도 절대 안 되는 오류인가 — 모델이 제공자에서 내려간 경우.
 *
 * 실사고 2026-07-29: 팀원 31명 중 30명이 `nvidia/qwen/qwen3-next-80b-a3b-instruct`에 배정돼
 * 있었는데 NVIDIA 카탈로그(102종)에서 그 모델이 **사라졌다**(410 Gone, qwen 계열 전멸).
 * VE는 이걸 "게이트웨이 오류(타임아웃 등)"로 표시하고 **5초 → 2분 재시도**를 돌렸다.
 * 원인을 잘못 지목한 데다, 될 리 없는 것을 2분 넘게 기다리게 만든다.
 * 410/404/model not found는 기다린다고 살아나지 않는다 — 즉시 멈추고 사실대로 말해야 한다.
 */
export function isDeadModelError(text: string): boolean {
  const t = text.slice(0, 600);
  return (
    /\b41[08]\s*status code/i.test(t) ||
    /\b404\s*status code/i.test(t) ||
    /model[_ ]?not[_ ]?found/i.test(t) ||
    /unknown model|no such model|model .* (is )?(not available|has been (retired|deprecated|removed))/i.test(t)
  );
}

export function isGatewayErrorText(text: string): boolean {
  const head = text.trim().slice(0, 300);
  return (
    head.length === 0 ||
    /^\(빈 응답\)/.test(head) || // 게이트웨이가 빈 스트림을 반환한 경우 (2026-07-13 실측: uiux 목업·사업 취합에서 발생 — 재시도 대상)
    /^LLM request timed out/i.test(head) ||
    /^The model did not produce a response/i.test(head) ||
    /\[channels\] failed to load/i.test(head) ||
    /(메모리|MEMORY 검색) 인덱스가 손상되어/i.test(head) ||
    /^openclaw (memory|gateway)/i.test(head) ||
    isPersonaLossText(head)
  );
}

/**
 * 페르소나 붕괴 감지 — 에이전트가 작업 대신 "저는 누구인가요?" 자기소개를 하는 응답.
 *
 * 실사고(2026-07-26 오너 보고): 회의 최종 취합에서 대표가
 * "방금 온라인에 접속했어요. 저는 어떤 역할·이름·이미지를 가지고 있나요?
 *  여러분은 어느 분이고, 어떻게 부르면 좋을까요?" 라고 답해 **산출물이 통째로 소실**됐다.
 * 원인은 agents/<id>/BOOTSTRAP.md("너는 방금 깨어났다, 네가 누군지 알아내라")가
 * IDENTITY.md 공란 상태에서 작업 지시를 덮어쓴 것. 그 파일들은 게이트웨이가 자동 생성·
 * 갱신하므로(gitignore) 언제든 되살아날 수 있다 — 그래서 코드에서도 막는다.
 * 이게 걸리면 runAgentSafe가 오류로 보고 재시도하므로, GDD·회의록에 저장되지 않는다.
 */
export function isPersonaLossText(text: string): boolean {
  const head = text.trim().slice(0, 400);
  if (head.length > 400) return false;
  const identityAsk =
    /(방금|막)\s*(온라인|접속|깨어)/.test(head) ||
    /(저는|제가)\s*(지금\s*)?(누구|어떤\s*(역할|이름))/.test(head) ||
    /어떻게\s*부르면/.test(head) ||
    /(just\s+(came|woke)|who\s+am\s+i)/i.test(head);
  // 자기소개 + 되묻기가 함께 있을 때만 붕괴로 본다 (정상 산출물의 오탐 방지)
  const asksBack = /\?|물어|알려\s*주|가르쳐\s*주/.test(head);
  return identityAsk && asksBack;
}

/** 에이전트 출력에서 GDD에 넣기 부적절한 잔여물(도구 JSON, 거대 base64 등)을 정리 */
export function sanitizeAgentOutput(text: string): string {
  let t = text.trim();
  // 모델이 도구 호출 JSON을 텍스트로 흘린 경우: proposal/content 필드만 건지거나 경고 표시
  if (t.startsWith("{") && /"(name|arguments|tool)"\s*:/.test(t.slice(0, 200))) {
    try {
      const j = JSON.parse(t);
      const inner =
        j?.arguments?.proposal_content ?? j?.arguments?.content ?? j?.content ?? null;
      if (typeof inner === "string" && inner.trim()) {
        t = inner.trim();
      } else {
        t = "> ⚠️ 모델이 도구 호출 형식으로 응답해 원문을 표시합니다.\n\n```\n" + t.slice(0, 1200) + "\n```";
      }
    } catch {
      /* JSON이 아니면 그대로 둔다 */
    }
  }
  // 개행 이스케이프 복원(도구 JSON에서 건진 경우)
  t = t.replace(/\\n/g, "\n");
  // 비정상적으로 긴 base64 덩어리 제거
  t = t.replace(/[A-Za-z0-9+/=]{400,}/g, "(생략된 데이터)");
  // 모델이 첫 줄에 섹션 제목 헤딩을 반복하는 버릇 정리(GDD 섹션 헤딩과 중복 방지)
  t = t.replace(/^#{1,3}\s[^\n]*\n+/, "");
  // 개행 유실(한 줄 벽글) 복원 — 표·헤딩·목록을 제 줄로
  return reflowMd(t.trim()).trim();
}
