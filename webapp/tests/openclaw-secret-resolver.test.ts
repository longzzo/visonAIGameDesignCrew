import { describe, expect, it, vi } from "vitest";
import { isOpenClawSecretRef, resolveOpenClawSecretInput } from "../server/openclaw-secret-resolver.mjs";

describe("OpenClaw SecretRef 서버 해석", () => {
  it("평문 토큰은 외부 해석기를 호출하지 않고 메모리에서 사용한다", async () => {
    const loadRuntime = vi.fn();
    await expect(resolveOpenClawSecretInput("  direct-token  ", {}, { loadRuntime })).resolves.toBe("direct-token");
    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it("store SecretRef를 OpenClaw 공식 런타임으로 해석한다", async () => {
    const ref = { source: "store" as const, provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" };
    const resolveSecretRefValues = vi.fn(async () => new Map([["store:default:OPENCLAW_GATEWAY_TOKEN", "protected-token"]]));
    const config = { gateway: { auth: { mode: "token", token: ref } } };
    await expect(resolveOpenClawSecretInput(ref, config, {
      env: {},
      loadRuntime: async () => ({ resolveSecretRefValues }),
    })).resolves.toBe("protected-token");
    expect(resolveSecretRefValues).toHaveBeenCalledWith([ref], { config, env: {} });
  });

  it("유효하지 않거나 비어 있는 해석 결과는 인증에 사용하지 않는다", async () => {
    const ref = { source: "store" as const, provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" };
    expect(isOpenClawSecretRef(ref)).toBe(true);
    expect(isOpenClawSecretRef({ source: "store", provider: "default" })).toBe(false);
    await expect(resolveOpenClawSecretInput(ref, {}, {
      loadRuntime: async () => ({ resolveSecretRefValues: async () => new Map() }),
    })).rejects.toThrow("해석하지 못했습니다");
  });
});
