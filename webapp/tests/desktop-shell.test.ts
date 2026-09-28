import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopMain = readFileSync(fileURLToPath(new URL("../../desktop/main.cjs", import.meta.url)), "utf-8");

describe("데스크톱 시작 경험", () => {
  it("메인 창과 독립된 로딩 창을 먼저 표시한다", () => {
    expect(desktopMain).toContain("let splashWin = null");
    expect(desktopMain).toMatch(/splashWin\s*=\s*new BrowserWindow\(\{/);
    expect(desktopMain).toMatch(/function createWindow\(\)[\s\S]*?show:\s*false/);
    expect(desktopMain).toContain("function revealMainWindow()");
    expect(desktopMain).toContain("AI가 늦어져도 Studio는 먼저 열립니다");
  });

  it("OpenClaw 준비가 Studio 런타임 시작을 막지 않는다", () => {
    expect(desktopMain).toMatch(/void tryStartOpenClawGateway\(openclawChanged\)\.then/);
    expect(desktopMain).toContain("waitForLocalPort(18789, 120_000)");
    expect(desktopMain).toContain('process.env.VE_USE_OPENCLAW_SERVICE === "1"');
    expect(desktopMain).toContain('scheduleGatewayRestart("readiness-timeout")');
    expect(desktopMain).toContain("gatewayRestartAttempts > 6");
  });

  it("OpenClaw는 하위 worker를 실행할 수 있는 외부 Node와 정리된 환경을 사용한다", () => {
    expect(desktopMain).toMatch(/spawn\(nodeRuntime, \[entry, "gateway", "run"/);
    expect(desktopMain).toContain("env: externalAiEnv()");
    expect(desktopMain).toContain('delete env[key]');
    expect(desktopMain).not.toMatch(/utilityProcess\.fork\(entry/);
  });

  it("OpenClaw 비밀정보 감사·이전도 중첩 UtilityProcess가 아닌 외부 Node worker를 사용한다", () => {
    expect(desktopMain).toMatch(/function protectOpenClawSecrets\(\)[\s\S]*?runNodeModule\(script/);
    expect(desktopMain).toMatch(/function auditOpenClawSecretProtection\(\)[\s\S]*?runNodeModule\(script/);
    expect(desktopMain).not.toMatch(/runUtilityModule\(script,[\s\S]*?VE_RUN_SECRET_(?:MIGRATION|AUDIT_ONLY)/);
  });
});
