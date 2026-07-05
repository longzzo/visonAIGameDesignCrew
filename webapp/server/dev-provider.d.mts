// dev-provider.mjs 타입 선언 (vite.config.ts 동적 import용)
export interface DevStep {
  kind: string;
  [k: string]: unknown;
}
export function runDevTask(opts: {
  agentId: string;
  task: string;
  model?: string;
  maxSteps?: number;
  onStep?: (step: DevStep) => void;
}): Promise<{ ok: boolean; transcript: DevStep[]; final: string }>;
export function runDevMeeting(opts: {
  leadId: string;
  task: string;
  onStep?: (step: DevStep) => void;
}): Promise<{ ok: boolean; verdict: string }>;
