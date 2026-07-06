// 타입 shim — vite.config.ts(TS)의 동적 import("./server/image-provider.mjs")용
export function nvidiaAvailable(): boolean;
export function classifySensitive(...texts: (string | undefined)[]): boolean;
export class PolicyRefusal extends Error {}
export function generateNvidiaImage(
  prompt: string,
  negative: string,
  opts?: { signal?: AbortSignal }
): Promise<string>;
