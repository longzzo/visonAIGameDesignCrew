// 마스터 GDD 마크다운 섹션 조작 + 로컬 API(/api/gdd) 입출력

export interface GddState {
  markdown: string;
  mtime: number;
}

export async function fetchGdd(): Promise<GddState> {
  const r = await fetch("/api/gdd");
  if (!r.ok) throw new Error(`GDD 읽기 실패 (${r.status})`);
  return (await r.json()) as GddState;
}

export async function saveGdd(markdown: string): Promise<number> {
  const r = await fetch("/api/gdd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `GDD 저장 실패 (${r.status})`);
  return j.mtime as number;
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
