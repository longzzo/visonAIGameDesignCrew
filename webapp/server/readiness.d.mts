export function readinessApiPlugin(): any;
export function resolveCodexWorkdir(): { dir: string; exists: boolean; writable: boolean; configured: boolean };
export function setCodexWorkdir(dir: string): { dir: string; exists: boolean; writable: boolean; configured: boolean };
export function importLegacyData(sourceRoot: string): any;
export function getReadiness(options?: { includePaths?: boolean }): Promise<any>;
