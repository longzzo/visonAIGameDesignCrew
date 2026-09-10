// prepare-env.mjs — 공개해도 되는 브라우저 기본값만 .env.local에 기록한다.
// 게이트웨이 토큰은 서버 릴레이가 ~/.openclaw/openclaw.json에서 직접 읽으며
// VITE_ 변수나 브라우저 번들에는 절대 넣지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env.local");
const CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");

function main() {
  try {
    JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch (e) {
    console.warn(`[prepare-env] ${CONFIG_PATH} 를 읽지 못했습니다: ${e.message}`);
    console.warn("[prepare-env] 서버 릴레이가 시작 후 다시 연결을 시도합니다.");
  }

  const lines = [
    `VITE_DEFAULT_MODEL=ollama/qwen3.5:4b`,
    "",
  ];
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
  console.log("[prepare-env] .env.local 생성 완료 — 게이트웨이 비밀은 서버 전용");
}

main();
