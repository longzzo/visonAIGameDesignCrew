export function hostnameAllowed(hostname: string, extraHosts?: string[]): boolean;
export function originMatchesRequest(origin: string, requestHost: string, extraHosts?: string[]): boolean;
export function applySecurityHeaders(response: { setHeader(name: string, value: string): void }): void;
