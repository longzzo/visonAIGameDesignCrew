import { describe, expect, it } from "vitest";
import {
  buildProtectionPlan,
  buildSecretMigration,
  inspectOpenClawSecretProtection,
  isSecretRef,
  migrationAuditOk,
  publicAuditSummary,
} from "../../scripts/migrate-openclaw-secrets.mjs";

describe("OpenClaw 비밀키 보호 이전", () => {
  it("평문 값은 계획에서 제외하고 store SecretRef만 만든다", () => {
    const secret = "nvapi-this-must-never-enter-the-plan";
    const migration = buildSecretMigration({
      models: { providers: { nvidia: { apiKey: secret } } },
    });
    expect(migration.entries.map((entry) => entry.name)).toEqual(["NVIDIA_API_KEY"]);
    expect(JSON.stringify(migration.plan)).not.toContain(secret);
    expect(migration.plan.targets[0].ref).toEqual({ source: "store", provider: "default", id: "NVIDIA_API_KEY" });
    expect(migration.plan.options).toEqual({
      scrubEnv: true,
      scrubAuthProfilesForProviderTargets: true,
      scrubLegacyAuthJson: false,
    });
  });

  it("이미 SecretRef이거나 자리표시자인 값은 다시 이전하지 않는다", () => {
    const ref = { source: "store", provider: "default", id: "GITHUB_MODELS_API_KEY" };
    expect(isSecretRef(ref)).toBe(true);
    const migration = buildSecretMigration({
      models: { providers: { github: { apiKey: ref }, nvidia: { apiKey: "{{API_KEY}}" } } },
    });
    expect(migration.entries).toEqual([]);
    expect(migration.plan.targets).toEqual([]);
  });

  it("Brave 플러그인의 공식 webSearch 경로를 보호 대상으로 만든다", () => {
    const migration = buildSecretMigration({
      plugins: { entries: { brave: { config: { webSearch: { apiKey: "brave-plaintext-for-test-only" } } } } },
    });
    expect(migration.entries.map((entry) => entry.name)).toEqual(["BRAVE_SEARCH_API_KEY"]);
    expect(migration.plan.targets[0]).toMatchObject({
      type: "plugins.entries.brave.config.webSearch.apiKey",
      path: "plugins.entries.brave.config.webSearch.apiKey",
      pathSegments: ["plugins", "entries", "brave", "config", "webSearch", "apiKey"],
      ref: { source: "store", provider: "default", id: "BRAVE_SEARCH_API_KEY" },
    });
  });

  it("Gateway 토큰도 보호 대상으로 만들고 평문이 남은 감사는 막는다", () => {
    const migration = buildSecretMigration({
      gateway: { auth: { token: "gateway-token-for-test-only" } },
    });
    expect(migration.entries.map((entry) => entry.name)).toEqual(["OPENCLAW_GATEWAY_TOKEN"]);
    expect(migration.plan.targets[0]).toMatchObject({
      type: "gateway.auth.token",
      path: "gateway.auth.token",
      pathSegments: ["gateway", "auth", "token"],
      ref: { source: "store", provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" },
    });
    expect(migrationAuditOk({
      summary: { unresolvedRefCount: 0 },
      findings: [{ code: "PLAINTEXT_FOUND", jsonPath: "gateway.auth.token" }],
    })).toBe(false);
    expect(migrationAuditOk({
      summary: { unresolvedRefCount: 0, plaintextCount: 0 },
      findings: [],
    })).toBe(true);
  });

  it("보호 계획에는 입력 값과 중복 ref 필드를 남기지 않는다", () => {
    const plan = buildProtectionPlan([{
      name: "NVIDIA_API_KEY",
      value: "never-persist-this-value",
      type: "models.providers.apiKey",
      path: "models.providers.nvidia.apiKey",
      pathSegments: ["models", "providers", "nvidia", "apiKey"],
      providerId: "nvidia",
      ref: { source: "env", provider: "default", id: "OLD" },
    }]);
    expect(JSON.stringify(plan)).not.toContain("never-persist-this-value");
    expect(plan.targets[0].ref).toEqual({ source: "store", provider: "default", id: "NVIDIA_API_KEY" });
  });

  it("읽기 전용 상태 점검은 평문 원문 없이 보호 개수만 안전하게 분류한다", () => {
    const gatewaySecret = "gateway-plaintext-never-return-this";
    const result = inspectOpenClawSecretProtection({
      gateway: { auth: { token: gatewaySecret } },
      models: { providers: { nvidia: { apiKey: { source: "store", provider: "default", id: "NVIDIA_API_KEY" } } } },
    });
    expect(result).toMatchObject({ protectedCount: 1, plaintextCount: 1, unconfiguredCount: 2 });
    expect(result.plaintextNames).toEqual(["OPENCLAW_GATEWAY_TOKEN"]);
    expect(JSON.stringify(result)).not.toContain(gatewaySecret);
  });

  it("OpenClaw 감사 결과는 경로나 값 없이 숫자 집계만 공개한다", () => {
    const result = publicAuditSummary({
      summary: { plaintextCount: 1, unresolvedRefCount: 2, refCount: 3 },
      findings: [{ code: "PLAINTEXT_FOUND", jsonPath: "gateway.auth.token", value: "never-expose" }],
    });
    expect(result).toEqual({ plaintextCount: 1, unresolvedRefCount: 2, refCount: 3 });
    expect(JSON.stringify(result)).not.toContain("gateway.auth.token");
    expect(JSON.stringify(result)).not.toContain("never-expose");
  });
});
