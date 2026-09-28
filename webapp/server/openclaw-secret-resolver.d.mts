export type OpenClawSecretRef = {
  source: "env" | "file" | "exec" | "store";
  provider: string;
  id: string;
};

export function isOpenClawSecretRef(value: unknown): value is OpenClawSecretRef;
export function findOpenClawPackageRoot(options?: { env?: NodeJS.ProcessEnv; home?: string }): string;
export function resolveOpenClawSecretInput(
  value: unknown,
  config: unknown,
  options?: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    loadRuntime?: (options: { env: NodeJS.ProcessEnv; home?: string }) => Promise<{
      resolveSecretRefValues(refs: OpenClawSecretRef[], options: unknown): Promise<Map<string, unknown>>;
    }>;
  },
): Promise<string>;
