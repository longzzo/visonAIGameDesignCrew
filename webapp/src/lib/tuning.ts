// 에이전트별 창의성(온도) 튜닝 — localStorage 영속.
// 게이트웨이(OpenClaw CLI)가 모델 temperature 파라미터를 노출하지 않으므로
// 프롬프트 지시문으로 반영한다: 낮음 = 보수적·정확성 우선, 높음 = 대담한 제안 우선.
// 기본값 5(중간)일 때는 아무 지시도 붙이지 않는다 — 기존 동작 그대로.

const TEMP_KEY = "ve-agent-temp";
export const TEMP_DEFAULT = 5;

export function loadTemps(): Record<string, number> {
  try {
    const t = JSON.parse(localStorage.getItem(TEMP_KEY) ?? "{}");
    return typeof t === "object" && t ? t : {};
  } catch {
    return {};
  }
}

export function saveTemp(id: string, v: number) {
  const t = loadTemps();
  if (v === TEMP_DEFAULT) delete t[id];
  else t[id] = Math.max(0, Math.min(10, Math.round(v)));
  try {
    localStorage.setItem(TEMP_KEY, JSON.stringify(t));
  } catch {
    /* noop */
  }
}

export function tempOf(id: string): number {
  const v = loadTemps()[id];
  return typeof v === "number" ? v : TEMP_DEFAULT;
}

/** 창의성 수치 → 프롬프트 앞에 붙일 작업 스타일 지시문 (기본 5면 빈 문자열) */
export function tempDirective(id: string): string {
  const v = tempOf(id);
  if (v === TEMP_DEFAULT) return "";
  if (v <= 2)
    return "[작업 스타일: 창의성 매우 낮음 — 확정된 사실·기존 기획에만 근거하고, 추측과 새 아이디어 제안은 하지 마라. 정확성과 일관성이 최우선이다.]\n\n";
  if (v <= 4)
    return "[작업 스타일: 창의성 낮음 — 검증된 안 위주로 보수적으로 작업해라. 모험적 제안은 1개 이하로.]\n\n";
  if (v <= 7)
    return "[작업 스타일: 창의성 높음 — 관례를 벗어난 신선한 아이디어를 1~2개 반드시 섞어라.]\n\n";
  return "[작업 스타일: 창의성 매우 높음 — 통상적인 답을 피하고 과감하고 독창적인 제안을 우선해라. 단, 확정된 결정사항은 뒤집지 마라.]\n\n";
}
