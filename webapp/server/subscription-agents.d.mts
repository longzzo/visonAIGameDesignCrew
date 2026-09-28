export type SubscriptionCliStatus = {
  installed: boolean;
  authenticated: boolean;
  subscription: boolean;
  version: string;
  detail: string;
  authMethod?: string;
  subscriptionType?: string;
};
export function subscriptionEnvironment(kind: "claude" | "codex", source?: Record<string, string | undefined>): Record<string, string>;
export function findClaudeExecutable(): string;
export function findCodexExecutable(): string;
export function invalidateSubscriptionStatus(): void;
export function checkClaudeSubscription(): Promise<SubscriptionCliStatus>;
export function checkCodexSubscription(): Promise<SubscriptionCliStatus>;
export function getSubscriptionStatus(options?: { maxAgeMs?: number }): Promise<{
  claude: SubscriptionCliStatus;
  codex: SubscriptionCliStatus;
  ready: boolean;
}>;
export function withSubscriptionSlot<T>(work: () => Promise<T>): Promise<T>;
export function runClaudeSubscription(options: {
  prompt: string;
  cwd: string;
  onStep?: (step: any) => void;
  signal?: AbortSignal;
  allowReadTools?: boolean;
}): Promise<{ ok: boolean; final: string; empty: boolean }>;
