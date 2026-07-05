// mcp-hub.mjs 타입 선언 (vite.config.ts의 동적 import용)
export function startHub(): Promise<unknown[]>;
export function statusList(): unknown[];
export function allTools(): { server: string; name: string; description: string; inputSchema: unknown }[];
export function toolsForAgent(agentId: string): { server: string; name: string; description: string; inputSchema: unknown }[];
export function assignmentsByServer(): Record<string, string[]>;
export function callTool(server: string, name: string, args: unknown): Promise<{ isError: boolean; text: string }>;
export function reconnect(): Promise<unknown[]>;
export function isStarted(): boolean;
