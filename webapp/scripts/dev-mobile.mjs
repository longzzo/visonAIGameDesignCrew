// dev-mobile.mjs — Tailscale 노출 모드로 Vite dev 서버를 띄운다.
// VE_EXPOSE=tailnet 을 설정하면 vite.config 가 Tailscale IPv4 에만 바인딩한다.
// (게이트웨이는 그대로 127.0.0.1 loopback — 이 서버가 서버측에서 프록시)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webappDir = path.resolve(__dirname, "..");
const viteBin = path.join(webappDir, "node_modules", "vite", "bin", "vite.js");

const child = spawn(process.execPath, [viteBin], {
  cwd: webappDir,
  stdio: "inherit",
  env: { ...process.env, VE_EXPOSE: "tailnet" },
});
child.on("exit", (code) => process.exit(code ?? 0));
