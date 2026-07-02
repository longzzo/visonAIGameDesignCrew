// Vision Engine 8개 에이전트 정의 (OpenClaw 설정과 동일한 id 사용)

export interface AgentDef {
  id: string;
  name: string;
  emoji: string;
  role: string;
  /** 이 에이전트가 소유한 마스터 GDD 섹션의 헤딩 접두사 */
  section: string;
  sectionTitle: string;
  color: string;
}

export const AGENTS: AgentDef[] = [
  { id: "pm", name: "PM 디렉터", emoji: "🎯", role: "총괄·컨셉·GDD 통합", section: "## 1.", sectionTitle: "개요", color: "#8b7cf6" },
  { id: "scenario", name: "시나리오 라이터", emoji: "📖", role: "세계관·스토리·캐릭터", section: "## 2.", sectionTitle: "세계관·스토리", color: "#f472b6" },
  { id: "gameplay", name: "게임플레이 디자이너", emoji: "🕹️", role: "코어 루프·메커니크", section: "## 3.", sectionTitle: "게임플레이", color: "#60a5fa" },
  { id: "systems", name: "시스템 디자이너", emoji: "⚙️", role: "성장·경제·콘텐츠 구조", section: "## 4.", sectionTitle: "시스템", color: "#fbbf24" },
  { id: "uiux", name: "UI/UX 디자이너", emoji: "🧭", role: "화면 구조·온보딩", section: "## 5.", sectionTitle: "UI/UX", color: "#34d399" },
  { id: "balance", name: "밸런스 디자이너", emoji: "⚖️", role: "수치·난이도 곡선", section: "## 6.", sectionTitle: "밸런스", color: "#a3e635" },
  { id: "bm", name: "BM 전략가", emoji: "💰", role: "수익모델·라이브옵스 (읽기 전용)", section: "## 7.", sectionTitle: "수익모델", color: "#fde047" },
  { id: "visual", name: "아트 디렉터", emoji: "🎨", role: "아트 스타일·팔레트", section: "## 8.", sectionTitle: "아트", color: "#e879f9" },
  { id: "td", name: "테크니컬 디렉터", emoji: "🛠️", role: "개발 명세·기능 목록·기술 리스크", section: "## 9.", sectionTitle: "기술", color: "#38bdf8" },
  { id: "scheduler", name: "스케줄러", emoji: "📅", role: "일정 설계·마일스톤·대회 역산", section: "## 10.", sectionTitle: "일정", color: "#fb923c" },
];

export const AGENT_MAP: Record<string, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a])
);

/** PM을 제외한 전문 에이전트 목록 (오케스트레이션 팬아웃 대상) */
export const SPECIALISTS = AGENTS.filter((a) => a.id !== "pm");

/**
 * 교차 검토 배정 — 각 산출물을 가장 이해관계가 얽힌 동료가 검토한다.
 *   시나리오 ← 게임플레이 (이야기가 플레이로 구현 가능한가)
 *   게임플레이 ← 시스템   (루프를 시스템이 지탱하는가)
 *   시스템 ← 밸런스       (구조가 수치적으로 지속 가능한가)
 *   밸런스 ← 시스템       (공식이 시스템 구조와 맞는가)
 *   UI/UX ← 게임플레이    (화면 흐름이 플레이 리듬과 맞는가)
 *   BM ← 게임플레이       (과금이 재미를 해치지 않는가)
 *   아트 ← 시나리오       (비주얼이 세계관과 맞는가)
 */
export const REVIEWERS: Record<string, string> = {
  scenario: "gameplay",
  gameplay: "systems",
  systems: "balance",
  balance: "systems",
  uiux: "gameplay",
  bm: "gameplay",
  visual: "scenario",
  td: "systems", //     기술 명세 ← 시스템    (명세가 시스템 구조를 다 담는가)
  scheduler: "td", //   일정 ← 테크니컬       (일정이 구현 난이도와 맞는가)
};

/**
 * 웹 리서치 허용 수준 — Brave 검색 키가 없으면 web_search가 오류를 뱉으므로
 * "fetch"(페이지 조회만)로 강등해 에이전트가 검색을 시도조차 하지 않게 한다.
 */
export type WebMode = "off" | "fetch" | "full";

/**
 * 증분(기획 보존) 지시 프롬프트 — 기존 GDD 섹션을 컨텍스트로 주고
 * 새 지시사항만 반영한 "갱신본"을 요구한다. 섹션이 비어 있으면 신규 작성 모드.
 * focus = PM이 자동 분배에서 이 에이전트에게 내린 배정 지시(있으면 우선 수행).
 */
export function specialistPrompt(
  request: string,
  agent: AgentDef,
  web: WebMode = "off",
  currentSection = "",
  overview = "",
  focus = ""
): string {
  const hasExisting = currentSection.trim().length > 0;
  const parts: string[] = [];
  if (overview.trim()) {
    parts.push(`[프로젝트 개요 — 참고용]`, overview.trim().slice(0, 400), ``);
  }
  if (hasExisting) {
    parts.push(
      `[현재 확정된 "${agent.sectionTitle}" 기획 — 이것이 기준이다]`,
      currentSection.slice(0, 1500),
      ``,
      `[오너의 새 지시사항]`,
      request.trim(),
      ``
    );
    if (focus.trim()) {
      parts.push(`[PM의 배정 지시 — 너의 몫은 이것이다]`, focus.trim(), ``);
    }
    parts.push(
      `위 지시사항을 기존 기획에 **반영**해 "${agent.sectionTitle}" 섹션의 갱신본 전체를 작성해라.`,
      `- 지시와 무관한 기존 확정 내용은 그대로 유지해라. 지시가 요구하는 부분만 바꾸거나 추가해라.`,
      `- 기존 기획을 무시하고 처음부터 새로 쓰지 마라.`
    );
  } else {
    parts.push(`[프로젝트 요청]`, request.trim(), ``);
    if (focus.trim()) {
      parts.push(`[PM의 배정 지시 — 너의 몫은 이것이다]`, focus.trim(), ``);
    }
    parts.push(
      `너의 워크스페이스 지침(AGENTS.md)의 산출물 형식에 따라, 이 게임의 "${agent.sectionTitle}" 파트를 새로 작성해라.`
    );
  }
  parts.push(
    `- 순수 마크다운 텍스트로만. 소제목(###) 사용.`,
    `- 20줄 이내로 간결하고 구체적으로.`,
    web === "full"
      ? `- 최신 정보·레퍼런스가 필요하면 web_search / web_fetch 도구로 조사해도 된다(다른 도구는 금지). 조사한 내용은 출처와 함께 본문에 녹여라.`
      : web === "fetch"
        ? `- 필요하면 web_fetch 도구로 알고 있는 URL의 페이지를 조회해도 된다. web_search는 지금 사용 불가이니 호출하지 마라(다른 도구도 금지).`
        : `- 도구/함수 호출 금지.`
  );
  return parts.join("\n");
}

/**
 * PM 자동 분배 프롬프트 — 오너 지시를 읽고 담당자와 배정 지시를 정하게 한다.
 * 로컬 모델도 안정적으로 파싱되도록 "할당: id | 지시" 한 줄 형식을 강제한다.
 */
export function pmRoutePrompt(request: string, pool: AgentDef[]): string {
  const roster = pool.map((a) => `- ${a.id} = ${a.name} (${a.role})`).join("\n");
  return [
    `너는 PM 디렉터다. 오너의 지시를 읽고 처리할 담당자를 정해라.`,
    ``,
    `[오너 지시]`,
    request.trim(),
    ``,
    `[담당자 목록]`,
    roster,
    ``,
    `규칙:`,
    `- 지시와 직접 관련된 담당자만 골라라. 보통 1~3명이면 충분하다. 지시가 게임 전체 컨셉이면 전원도 가능.`,
    `- 담당자마다 아래 형식으로 정확히 한 줄씩만 출력해라. 다른 설명·인사·도구 호출은 절대 금지.`,
    ``,
    `할당: <id> | <그 담당자에게 전달할 구체적 한 줄 지시>`,
    ``,
    `예시:`,
    `할당: scenario | 주인공과 라이벌의 관계 설정을 세계관에 추가해라`,
  ].join("\n");
}

/** 역할별 기본 보고서 주제 — 📋 버튼을 눌렀을 때 입력창의 기본값 */
export const DEFAULT_REPORT_TOPIC: Record<string, string> = {
  pm: "프로젝트 종합 현황 보고서",
  scenario: "세계관·캐릭터 설정집",
  gameplay: "게임플레이 상세 명세서",
  systems: "시스템 설계 명세서",
  uiux: "UI/UX 화면 명세서 (와이어프레임 텍스트 기술)",
  balance: "밸런스 수치 명세서 (전체 표 포함)",
  bm: "수익모델 제안 보고서",
  visual: "아트 명세서 (스타일 가이드 + 에셋 목록)",
  td: "개발 명세서 (기능 목록 + 난이도 판정)",
  scheduler: "개발 일정표 (목표일과 요구 수준을 함께 적어주세요)",
};

/**
 * 정식 보고서(명세서) 생성 프롬프트 — 채팅 답변과 달리 분량 제한 없이
 * 실무 문서 수준을 요구한다. 현재 GDD 전문을 근거로 삼는다.
 */
export function reportPrompt(agent: AgentDef, topic: string, gddFull: string): string {
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  return [
    `너는 ${agent.name}(${agent.role})다. 오너가 정식 보고서를 요청했다: "${topic.trim()}"`,
    `오늘 날짜: ${today} — 일정·기간 계산은 반드시 이 날짜 기준으로 해라.`,
    ``,
    `[현재 마스터 GDD 전문 — 이것이 근거 자료다]`,
    gddFull.slice(0, 12000) || `(아직 기획이 없다 — 보고서 안에서 전제를 명시하고 제안 형태로 작성해라)`,
    ``,
    `위 기획을 근거로 "${topic.trim()}" 보고서를 작성해라.`,
    `- 실무자가 그대로 들고 작업할 수 있는 수준으로 구체적으로. 표·체크리스트를 적극 사용해라.`,
    `- 구조: # 제목 → 목적·범위 → 본문(세부 명세, 필요한 만큼 소제목 분할) → 리스크·미결정 사항 → 다음 액션 3개.`,
    `- 채팅 답변이 아니라 문서다. 분량 제한 없음 — 상세할수록 좋다. 인사말·사족 금지.`,
    `- 순수 마크다운 텍스트로만. 도구 호출 금지(웹 조사가 꼭 필요하면 web_fetch만).`,
  ].join("\n");
}

/**
 * 아트 디렉터에게 Stable Diffusion 프롬프트 작성을 의뢰 —
 * 아트 인턴(로컬 SD)이 그대로 넣을 수 있는 영어 태그 프롬프트를 받아낸다.
 */
export function sdPromptPrompt(request: string, artSection: string, overview: string): string {
  return [
    `너는 아트 디렉터다. 아트 인턴이 Stable Diffusion으로 컨셉 아트를 뽑을 수 있게 프롬프트를 써줘라.`,
    overview.trim() ? `[프로젝트 개요]\n${overview.trim().slice(0, 300)}` : ``,
    artSection.trim() ? `[확정된 아트 방향 — 반드시 이 스타일을 따라라]\n${artSection.slice(0, 800)}` : ``,
    `[오너의 컨셉 아트 요청]`,
    request.trim(),
    ``,
    `출력은 정확히 아래 두 줄만. 다른 말·설명·도구 호출 금지.`,
    `PROMPT: <영어 태그 프롬프트 — 주제, 구도, 스타일, 조명, 색감 순. 60단어 이내>`,
    `NEGATIVE: <영어 네거티브 태그 — 15단어 이내>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** sdPromptPrompt 응답에서 PROMPT/NEGATIVE 줄 파싱 */
export function parseSdPrompt(text: string): { prompt: string; negative: string } | null {
  const p = /^\s*\**PROMPT\**\s*[:：]\s*(.+)$/im.exec(text);
  const n = /^\s*\**NEGATIVE\**\s*[:：]\s*(.+)$/im.exec(text);
  if (!p) return null;
  return { prompt: p[1].trim(), negative: n?.[1]?.trim() ?? "" };
}

/** PM 자동 분배 응답 파싱 — "할당: id | 지시" 줄만 추출, 유효한 전문가 id만 채택 */
export function parseRoutePlan(text: string, validIds: string[]): { id: string; directive: string }[] {
  const out: { id: string; directive: string }[] = [];
  const seen = new Set<string>();
  const re = /^[\s*>-]*(?:할당|assign)\s*[:：]\s*\**([a-z]+)\**\s*[|｜]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].toLowerCase();
    const directive = m[2].trim().replace(/\**$/, "");
    if (validIds.includes(id) && !seen.has(id) && directive) {
      seen.add(id);
      out.push({ id, directive });
    }
  }
  return out;
}

/**
 * 1:1 대화 결론에 대한 PM 검증 프롬프트 — 기존 기획과 대조하고
 * "### 반영안" 헤딩 아래 섹션 갱신 최종본을 요구한다.
 */
export function pmVerifyPrompt(agent: AgentDef, proposal: string, currentSection: string, overview: string): string {
  return [
    `너는 PM이다. 오너가 ${agent.name}와 1:1로 논의해 내린 결론이다:`,
    `---`,
    proposal.slice(0, 1500),
    `---`,
    overview.trim() ? `[프로젝트 개요 — 참고]\n${overview.trim().slice(0, 400)}` : ``,
    `[현재 GDD "${agent.sectionTitle}" 섹션]`,
    currentSection.slice(0, 1200) || `(아직 비어 있음)`,
    ``,
    `1) 이 결론이 기존 기획과 모순되거나 위험한 점이 있으면 최대 3줄로 짚어라. 없으면 "문제 없음"이라고 써라.`,
    `2) 반영 권고 여부를 한 줄로 밝혀라.`,
    `3) 마지막에 반드시 "### 반영안" 헤딩을 쓰고, 그 아래에 결론을 반영한 "${agent.sectionTitle}" 섹션 갱신본 전체를 작성해라.`,
    `   (기존 내용 중 결론과 무관한 부분은 유지)`,
    `총 30줄 이내, 순수 마크다운, 도구 호출 금지.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 동료 검토 지시 (reviewer 에이전트에게 전송) */
export function reviewPrompt(request: string, author: AgentDef, reviewer: AgentDef, draft: string): string {
  return [
    `[프로젝트 요청]`,
    request.trim(),
    ``,
    `동료 ${author.name}가 작성한 "${author.sectionTitle}" 초안이다:`,
    `---`,
    draft.slice(0, 1500),
    `---`,
    `너(${reviewer.name})의 전문 관점에서 이 초안을 검토해라.`,
    `형식: 좋은 점 1개 → 문제점 최대 2개 → 구체적 개선 제안 최대 2개.`,
    `8줄 이내, 순수 마크다운. 도구/함수 호출 금지.`,
  ].join("\n");
}

/** 검토 반영 수정 지시 (원 작성자에게 전송 — 같은 세션이라 초안 맥락 유지됨) */
export function revisePrompt(author: AgentDef, reviewer: AgentDef, review: string): string {
  return [
    `동료 ${reviewer.name}가 네 "${author.sectionTitle}" 초안을 검토한 의견이다:`,
    `---`,
    review.slice(0, 1000),
    `---`,
    `타당한 지적만 반영해 초안을 수정하고, 수정된 최종본 전체만 출력해라.`,
    `20줄 이내, 순수 마크다운. 도구/함수 호출 금지. 검토에 대한 답변이나 사족은 쓰지 마라.`,
  ].join("\n");
}

export function pmSummaryPrompt(
  request: string,
  outputs: { agent: AgentDef; text: string }[],
  currentOverview = ""
): string {
  const digest = outputs
    .map(({ agent, text }) => `### ${agent.sectionTitle} (${agent.name})\n${text.slice(0, 400)}`)
    .join("\n\n");
  const hasExisting = currentOverview.trim().length > 0;
  return [
    hasExisting ? `[현재 "1. 개요" 섹션 — 이것이 기준이다]\n${currentOverview.slice(0, 800)}\n` : ``,
    `[오너의 새 지시사항]`,
    request.trim(),
    ``,
    `[이번에 갱신된 산출물 요약]`,
    digest,
    ``,
    hasExisting
      ? `기존 개요를 유지하되, 이번 지시와 갱신 산출물이 요구하는 부분만 반영해 "1. 개요" 갱신본을 작성해라. 처음부터 새로 쓰지 마라.`
      : `위 산출물을 종합해 마스터 GDD의 "1. 개요" 섹션을 작성해라.`,
    `형식: 한 줄 피치 → 장르/플랫폼/타깃 → 핵심 루프 3줄 → 차별점 2개 → 산출물 간 충돌·조정 필요 사항(있으면 1~2개).`,
    `12줄 이내 순수 마크다운. 도구/함수 호출 금지.`,
  ]
    .filter(Boolean)
    .join("\n");
}
