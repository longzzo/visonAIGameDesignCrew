export type SecretRef = {
  source: "env" | "file" | "exec" | "store";
  provider: string;
  id: string;
};

export type SecretProtectionItem = {
  name: string;
  value: string;
  type: string;
  path: string;
  pathSegments: string[];
  providerId?: string;
  accountId?: string;
  agentId?: string;
  authProfileProvider?: string;
  ref?: SecretRef;
};

export type SecretProtectionPlan = {
  version: 1;
  protocolVersion: 1;
  targets: Array<Omit<SecretProtectionItem, "name" | "value"> & { ref: SecretRef }>;
  options: {
    scrubEnv: boolean;
    scrubAuthProfilesForProviderTargets: boolean;
    scrubLegacyAuthJson: false;
  };
};

export const SECRET_SPECS: ReadonlyArray<Omit<SecretProtectionItem, "value" | "ref">>;
export function isSecretRef(value: unknown): value is SecretRef;
export function migrationAuditOk(report: unknown): boolean;
export function buildSecretMigration(config: unknown): {
  entries: Array<Pick<SecretProtectionItem, "name" | "value">>;
  plan: SecretProtectionPlan;
};
export function buildProtectionPlan(items: SecretProtectionItem[]): SecretProtectionPlan;
export function protectOpenClawValues(
  items: SecretProtectionItem[],
  options?: { nodeRuntime?: string; entry?: string },
): Promise<void>;
export function migrateOpenClawSecrets(options?: {
  configFile?: string;
  nodeRuntime?: string;
  entry?: string;
}): Promise<{
  ok: boolean;
  changed: boolean;
  migrated: string[];
  audit: unknown;
}>;
