// 실제 사용자 설정을 건드리지 않고 OpenClaw store SecretRef → Vision Engine 릴레이 해석을 검증한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveOpenClawSecretInput } from "../webapp/server/openclaw-secret-resolver.mjs";

const entry = [
  process.env.VE_OPENCLAW_ENTRY,
  process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
  path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!entry) throw new Error("OpenClaw CLI를 찾지 못했습니다.");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-gateway-secret-smoke-"));
const configFile = path.join(temp, "openclaw.json");
const secret = `ve-isolated-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ref = { source: "store", provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" };
const config = {
  secrets: { providers: { default: { source: "store" } } },
  gateway: { auth: { mode: "token", token: ref } },
};
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: temp,
  OPENCLAW_CONFIG_PATH: configFile,
  VE_OPENCLAW_ENTRY: entry,
};

try {
  fs.mkdirSync(path.join(temp, "state"), { recursive: true });
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  const stored = spawnSync(process.execPath, [entry, "secrets", "store", "set", ref.id, "--kind", "secret", "--value-file", "-"], {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 60_000,
    input: secret,
    env,
  });
  if (stored.status !== 0) throw new Error(String(stored.stderr || stored.stdout || "격리 비밀 저장 실패").trim());
  const resolved = await resolveOpenClawSecretInput(ref, config, { env });
  if (resolved !== secret) throw new Error("Gateway SecretRef 해석 결과가 원본과 일치하지 않습니다.");
  console.log("✅ OpenClaw Gateway SecretRef 격리 smoke 통과: store 저장·서버 메모리 해석·평문 파일 미기록");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
