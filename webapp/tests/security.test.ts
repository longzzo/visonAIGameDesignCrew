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

  it("사용자 API 키는 마스킹된 입력창으로만 받고 등록 후 다시 표시하지 않는다", () => {
    const keyCenter = read("src/components/UserKeyCenter.tsx");
    const dialog = read("src/components/DialogHost.tsx");
    const sidebar = read("src/components/Sidebar.tsx");
    const profile = read("src/components/AgentProfile.tsx");
    const notion = read("src/components/DocViewer.tsx");

    expect(keyCenter).toContain('type="password"');
    expect(keyCenter).toContain('autoComplete="new-password"');
    expect(keyCenter).toContain('setValues((current) => ({ ...current, [provider]: "" }))');
    expect(dialog).toContain('type={req.sensitive ? "password" : "text"}');
    expect(notion).toMatch(/노션 연동 ① 통합 토큰[\s\S]*?sensitive: true/);
    expect(sidebar).not.toContain("uiPrompt");
    expect(profile).not.toContain("uiPrompt");
  });
});
