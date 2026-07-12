// 옵시디안 볼트 연동 — 볼트의 #ve-학습 노트를 지식 라이브러리로 들여오고,
// 산출물(GDD·보고서)은 서버가 볼트 VisionEngine/ 폴더에 자동 아카이브한다.

export interface ObsidianStatus {
  connected: boolean;
  vault: string | null;
  exportDir: string | null;
  learnTag: string;
}

export interface ObsidianNoteInfo {
  /** 볼트 기준 상대 경로 */
  path: string;
  title: string;
  mtime: number;
  /** new=미학습, updated=학습 후 노트가 수정됨, learned=최신 학습 완료 */
  state: "new" | "updated" | "learned";
}

export interface ObsidianNote {
  title: string;
  /** frontmatter 제거 + 위키링크 정리된 본문 */
  content: string;
  /** frontmatter agents — 있으면 PM 판정 대신 이 대상을 우선한다 */
  agents: string[];
  mtime: number;
}

export async function getObsidianStatus(): Promise<ObsidianStatus> {
  try {
    const r = await fetch("/api/obsidian/status");
    if (!r.ok) throw new Error();
    return (await r.json()) as ObsidianStatus;
  } catch {
    return { connected: false, vault: null, exportDir: null, learnTag: "ve-학습" };
  }
}

export async function listObsidianLearnNotes(): Promise<ObsidianNoteInfo[]> {
  try {
    const r = await fetch("/api/obsidian/learn");
    if (!r.ok) return [];
    return (await r.json()).notes ?? [];
  } catch {
    return [];
  }
}

export async function fetchObsidianNote(relPath: string, fromSearch = false): Promise<ObsidianNote> {
  const r = await fetch(`/api/obsidian/note?path=${encodeURIComponent(relPath)}${fromSearch ? "&from=search" : ""}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "노트 읽기 실패");
  return j as ObsidianNote;
}

export interface ObsidianSearchHit {
  path: string;
  title: string;
  snippet: string;
  mtime: number;
  /** VisionEngine/ 내보내기 사본 여부 (VE 산출물) */
  fromExport: boolean;
}

/** 📚 사서 — 볼트 전문 검색 (제목·본문) */
export async function searchObsidian(q: string): Promise<ObsidianSearchHit[]> {
  try {
    const r = await fetch(`/api/obsidian/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    return (await r.json()).results ?? [];
  } catch {
    return [];
  }
}

/** 회의 주입용 사서 블록 — 요청과 관련된 볼트 노트 상위 n건을 발췌한다 (없으면 빈 문자열) */
export async function librarianBlock(query: string, n = 3): Promise<string> {
  const hits = (await searchObsidian(query)).filter((h) => !h.fromExport).slice(0, n);
  if (hits.length === 0) return "";
  const parts: string[] = [`[📚 옵시디언 사서 — 오너 볼트에서 찾은 관련 노트 ${hits.length}건. 기존 기획·아이디어와 모순되지 않게 참고하라]`];
  for (const h of hits) {
    try {
      const note = await fetchObsidianNote(h.path, true);
      parts.push(`--- 노트: ${note.title} ---\n${note.content.slice(0, 1500)}`);
    } catch {
      parts.push(`--- 노트: ${h.title} ---\n${h.snippet}`);
    }
  }
  return parts.join("\n");
}
