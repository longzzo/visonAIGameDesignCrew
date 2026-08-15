import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webapp = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(webapp, rel), "utf-8");

describe("게이트웨이 비밀 경계", () => {
  it("브라우저 환경과 소스에 게이트웨이 토큰을 주입하지 않는다", () => {
    expect(read("scripts/prepare-env.mjs")).not.toContain("VITE_GATEWAY_TOKEN");
    expect(read("src/lib/gateway.ts")).not.toContain("VITE_GATEWAY_TOKEN");
    expect(read("src/lib/gateway.ts")).not.toContain("/gateway-ws");
  });

  it("릴레이는 읽기 스코프만 요청하고 쓰기 스코프를 요청하지 않는다", () => {
    const relay = read("server/gateway-relay.mjs");
    expect(relay).toContain('scopes: ["operator.read"]');
    expect(relay).not.toContain('"operator.write"');
  });
});
