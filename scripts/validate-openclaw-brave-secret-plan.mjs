// 설치된 Brave 플러그인의 SecretRef 경로를 변경 없이 검증한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const entry = [
  process.env.VE_OPENCLAW_ENTRY,
  process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!entry) throw new Error("OpenClaw CLI를 찾지 못했습니다.");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-brave-plan-"));
const planFile = path.join(temp, "plan.json");
try {
  const plan = {
    version: 1,
    protocolVersion: 1,
    targets: [{
      type: "plugins.entries.brave.config.webSearch.apiKey",
      path: "plugins.entries.brave.config.webSearch.apiKey",
      pathSegments: ["plugins", "entries", "brave", "config", "webSearch", "apiKey"],
      ref: { source: "env", provider: "default", id: "BRAVE_SEARCH_API_KEY" },
    }],
    options: {
      scrubEnv: true,
      scrubAuthProfilesForProviderTargets: true,
      scrubLegacyAuthJson: false,
    },
  };
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  const checked = spawnSync(process.execPath, [entry, "secrets", "apply", "--from", planFile, "--dry-run"], {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, BRAVE_SEARCH_API_KEY: "fake-brave-key-for-read-only-plan-validation" },
  });
  if (checked.status !== 0) throw new Error(String(checked.stderr || checked.stdout || "Brave SecretRef dry-run 실패").trim());
  console.log("✅ Brave 플러그인 SecretRef 계획 dry-run 통과 (설정 변경 없음)");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
