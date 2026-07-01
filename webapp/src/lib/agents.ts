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
];

export const AGENT_MAP: Record<string, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a])
);

/** PM을 제외한 전문 에이전트 목록 (오케스트레이션 팬아웃 대상) */
export const SPECIALISTS = AGENTS.filter((a) => a.id !== "pm");

export function specialistPrompt(request: string, agent: AgentDef): string {
  return [
    `[프로젝트 요청]`,
    request.trim(),
    ``,
    `너의 워크스페이스 지침(AGENTS.md)의 산출물 형식에 따라, 이 게임의 "${agent.sectionTitle}" 파트를 작성해라.`,
    `- 순수 마크다운 텍스트로만. 소제목(###) 사용.`,
    `- 20줄 이내로 간결하고 구체적으로.`,
    `- 도구/함수 호출 금지.`,
  ].join("\n");
}

export function pmSummaryPrompt(request: string, outputs: { agent: AgentDef; text: string }[]): string {
  const digest = outputs
    .map(({ agent, text }) => `### ${agent.sectionTitle} (${agent.name})\n${text.slice(0, 400)}`)
    .join("\n\n");
  return [
    `[프로젝트 요청]`,
    request.trim(),
    ``,
    `[전문 에이전트 산출물 요약]`,
    digest,
    ``,
    `위 산출물을 종합해 마스터 GDD의 "1. 개요" 섹션을 작성해라.`,
    `형식: 한 줄 피치 → 장르/플랫폼/타깃 → 핵심 루프 3줄 → 차별점 2개 → 산출물 간 충돌·조정 필요 사항(있으면 1~2개).`,
    `12줄 이내 순수 마크다운. 도구/함수 호출 금지.`,
  ].join("\n");
}
