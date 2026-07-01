// prepare-env.mjs — ~/.openclaw/openclaw.json 에서 게이트웨이 토큰/포트를 읽어
// .env.local 을 생성한다. (npm run dev 앞에서 자동 실행됨)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env.local");
const CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");

function main() {
  let token = "";
  let port = 18789;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    token = cfg?.gateway?.auth?.token ?? "";
    port = cfg?.gateway?.port ?? 18789;
  } catch (e) {
    console.warn(`[prepare-env] ${CONFIG_PATH} 를 읽지 못했습니다: ${e.message}`);
    console.warn("[prepare-env] 게이트웨이 토큰 없이 .env.local 을 생성합니다 (연결 시 인증 실패 가능).");
  }

  const lines = [
    `VITE_GATEWAY_URL=ws://127.0.0.1:${port}`,
    `VITE_GATEWAY_HTTP=http://127.0.0.1:${port}`,
    `VITE_GATEWAY_TOKEN=${token}`,
    `VITE_DEFAULT_MODEL=ollama/qwen3:8b`,
    "",
  ];
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
  const masked = token ? token.slice(0, 6) + "…" + token.slice(-4) : "(없음)";
  console.log(`[prepare-env] .env.local 생성 완료 — port=${port}, token=${masked}`);
}

main();
