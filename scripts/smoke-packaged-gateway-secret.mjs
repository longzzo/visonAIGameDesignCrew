// 최종 win-unpacked Studio 런타임이 OpenClaw store SecretRef를 해석해 Gateway 인증에 쓰는지 격리 검증한다.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webappRoot = path.resolve(process.env.VE_PACKAGED_WEBAPP_ROOT
  || path.join(root, "desktop", "dist-installer", "win-unpacked", "resources", "vision-engine", "webapp"));
const runtimeFile = path.join(webappRoot, "dist-server", "runtime.mjs");
const entry = [
  process.env.VE_OPENCLAW_ENTRY,
  process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
  path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!fs.existsSync(runtimeFile)) throw new Error(`패키지 Studio 런타임을 찾지 못했습니다: ${runtimeFile}`);
if (!entry) throw new Error("OpenClaw CLI를 찾지 못했습니다.");

const requireFromRuntime = createRequire(path.join(webappRoot, "package.json"));
const { WebSocketServer } = requireFromRuntime("ws");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-packaged-secret-smoke-"));
const configFile = path.join(temp, "openclaw.json");
const secret = `ve-packaged-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ref = { source: "store", provider: "default", id: "OPENCLAW_GATEWAY_TOKEN" };
let runtime;
let gatewayServer;

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});
const closeServer = (server) => new Promise((resolve) => server?.close(() => resolve()));

try {
  const [gatewayPort, runtimePort] = await Promise.all([freePort(), freePort()]);
  const config = {
    secrets: { providers: { default: { source: "store" } } },
    gateway: { port: gatewayPort, auth: { mode: "token", token: ref } },
    agents: { list: [] },
  };
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: temp,
    OPENCLAW_CONFIG_PATH: configFile,
    VE_OPENCLAW_ENTRY: entry,
    VE_WEBAPP_ROOT: webappRoot,
    VE_REPO_ROOT: path.dirname(path.dirname(webappRoot)),
    VE_DATA_ROOT: path.join(temp, "vision-engine-data"),
    VE_DESKTOP: "1",
    VE_RUNTIME_HOST: "127.0.0.1",
    VE_RUNTIME_PORT: String(runtimePort),
  };
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

  let authenticated = false;
  gatewayServer = new WebSocketServer({ host: "127.0.0.1", port: gatewayPort });
  gatewayServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let frame;
      try { frame = JSON.parse(String(raw)); } catch { return; }
      if (frame?.method !== "connect") return;
      authenticated = frame?.params?.auth?.token === secret;
      if (!authenticated) { socket.close(); return; }
      socket.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { type: "hello-ok", server: { version: "secretref-smoke" } },
      }));
    });
  });

  runtime = spawn(process.execPath, [runtimeFile], {
    cwd: path.dirname(runtimeFile),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  let runtimeOutput = "";
  runtime.stdout.on("data", (chunk) => { runtimeOutput = `${runtimeOutput}${chunk}`.slice(-8_000); });
  runtime.stderr.on("data", (chunk) => { runtimeOutput = `${runtimeOutput}${chunk}`.slice(-8_000); });

  const deadline = Date.now() + 30_000;
  let relay;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      relay = await fetch(`http://127.0.0.1:${runtimePort}/api/gateway/status`).then((response) => response.json());
      if (relay?.connected && authenticated) break;
    } catch { /* 런타임 준비 중 */ }
  }
  if (!authenticated || !relay?.connected) {
    throw new Error(`패키지 Gateway SecretRef 연결 실패: ${String(relay?.detail || runtimeOutput || "준비 시간 초과").slice(0, 400)}`);
  }
  console.log("✅ 패키지 Gateway SecretRef smoke 통과: store → 최종 Studio 런타임 → WebSocket 인증");
} finally {
  runtime?.kill();
  await closeServer(gatewayServer);
  fs.rmSync(temp, { recursive: true, force: true });
}
