export interface UsageTotal {
  input: number;
  output: number;
  calls: number;
  estimated: boolean;
}

export interface UsageSummary {
  today: UsageTotal;
  week: UsageTotal;
  all: UsageTotal;
}

const empty = (): UsageTotal => ({ input: 0, output: 0, calls: 0, estimated: false });
export const emptyUsageSummary = (): UsageSummary => ({ today: empty(), week: empty(), all: empty() });

export async function loadUsage(): Promise<UsageSummary> {
  const response = await fetch("/api/usage");
  if (!response.ok) throw new Error(`사용량 조회 실패 (${response.status})`);
  const json = await response.json();
  return { today: json.today, week: json.week, all: json.all };
}

export async function recordUsage(entry: UsageTotal & { model: string }): Promise<UsageSummary> {
  const response = await fetch("/api/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error(`사용량 저장 실패 (${response.status})`);
  const json = await response.json();
  return { today: json.today, week: json.week, all: json.all };
}
