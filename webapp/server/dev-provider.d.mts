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
export function runCodexTask(opts: {
  agentId: string;
  task: string;
  onStep?: (step: DevStep) => void;
  readOnly?: boolean;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; transcript: DevStep[]; final: string }>;
export function runClaudeTask(opts: {
  agentId: string;
  task: string;
  onStep?: (step: DevStep) => void;
  allowReadTools?: boolean;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; final: string }>;
export function runSubscriptionAgent(opts: {
  agentId: string;
  task: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; final: string }>;
export function runSubscriptionTask(opts: {
  agentId: string;
  task: string;
  onStep?: (step: DevStep) => void;
}): Promise<{ ok: boolean; final: string }>;
export function runDevMeeting(opts: {
  leadId: string;
  task: string;
  engine?: "subscription" | "claude" | "codex" | "provider";
  onStep?: (step: DevStep) => void;
}): Promise<{ ok: boolean; verdict: string }>;
export function resolveProvider(model: string, config: any): any;
