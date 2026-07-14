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

/* ── 🎨 톤앤매너 가이드 (오너 지시 2026-07-14: 산출물 문체 널뜀 교정) ──
 * 볼트에서 파일명에 "톤앤매너"가 든 노트를 정본으로 읽어 모든 생산 프롬프트에 주입한다.
 * 오너가 옵시디언에서 노트를 고치면 다음 호출(캐시 2분)부터 반영 — 게이트웨이 재시작 불필요. */

let styleCache: { text: string; at: number } | null = null;

export async function styleBlock(): Promise<string> {
  if (styleCache && Date.now() - styleCache.at < 120_000) return styleCache.text;
  let text = "";
  try {
    const r = await fetch("/api/obsidian/style");
    if (r.ok) {
      const j = await r.json();
      if (j.found && j.content) {
        text = `[🎨 톤앤매너 가이드 — 오너 정본(볼트 「${j.title}」). 아래 문체·용어·톤 규칙을 산출물에 그대로 적용하고, 가이드와 충돌하는 표현은 고쳐 써라]\n${String(j.content).slice(0, 2500)}`;
      }
    }
  } catch {
    /* 볼트 없음/실패 = 가이드 없이 진행 */
  }
  styleCache = { text, at: Date.now() };
  return text;
}

/** 회의 주입용 사서 블록 — 요청과 관련된 볼트 노트 상위 n건을 발췌한다 (없으면 빈 문자열) */
export async function librarianBlock(query: string, n = 3): Promise<string> {
  const all = await searchObsidian(query);
  // 오너 자필 노트 우선. VE 내보내기 사본 중 "가져온 문서"(오너 원본 기획 딥리드 전문)만 예외로 보충 —
  // GDD·회의록 사본은 이미 프롬프트에 있는 내용이라 제외.
  const own = all.filter((h) => !h.fromExport);
  const imported = all.filter((h) => h.fromExport && h.title.includes("가져온 문서"));
  const hits = [...own, ...imported].slice(0, n);
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
