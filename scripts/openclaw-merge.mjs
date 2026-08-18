/**
 * Vision Engine 기본 에이전트를 기존 OpenClaw 설정과 합친다.
 *
 * manifest에 있는 에이전트는 최신 템플릿을 기준으로 갱신하되 사용자가 고른 모델은
 * 보존한다. manifest 밖의 사용자/레거시 에이전트는 절대 삭제하지 않고 원본 그대로
 * 뒤에 붙인다. 설치·업데이트가 개인 로스터를 훼손하지 않게 하는 순수 함수다.
 */
export function mergeAgentRoster({ templateAgents, previousAgents, roles, modelPolicy, providerReady }) {
  const previous = new Map((previousAgents ?? []).map((agent) => [agent.id, agent]));
  const managedIds = new Set((templateAgents ?? []).map((agent) => agent.id));
  const retired = (model) =>
    typeof model === "string" && modelPolicy.retiredModelPatterns.some((needle) => model.includes(needle));

  const managed = (templateAgents ?? []).map((source) => {
    const agent = structuredClone(source);
    const previousModel = previous.get(agent.id)?.model;
    if (previousModel && !retired(previousModel)) agent.model = previousModel;
    if (!agent.model || retired(agent.model)) {
      agent.model = modelPolicy.roles[roles.get(agent.id)] ?? modelPolicy.localFallback;
    }
    if (!providerReady(agent.model)) agent.model = modelPolicy.localFallback;
    return agent;
  });

  const custom = (previousAgents ?? [])
    .filter((agent) => agent?.id && !managedIds.has(agent.id))
    .map((agent) => structuredClone(agent));
  return { agents: [...managed, ...custom], customIds: custom.map((agent) => agent.id) };
}

/** 템플릿에 없는 사용자 확장 설정(채널·플러그인·추가 제공자 등)을 재귀적으로 보존한다. */
export function preserveUnknownConfig(template, previous) {
  if (!template || typeof template !== "object" || Array.isArray(template)) return template;
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return template;
  for (const [key, value] of Object.entries(previous)) {
    if (!(key in template)) {
      template[key] = structuredClone(value);
      continue;
    }
    if (template[key] && value && typeof template[key] === "object" && typeof value === "object" && !Array.isArray(template[key]) && !Array.isArray(value)) {
      preserveUnknownConfig(template[key], value);
    }
  }
  return template;
}
