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
  return t.trim();
}
