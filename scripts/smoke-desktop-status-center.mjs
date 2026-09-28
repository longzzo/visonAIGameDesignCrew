// 최종 win-unpacked Electron 앱의 실제 renderer/preload/IPC/상태센터를 격리 실행해 검증한다.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unpacked = path.join(root, "desktop", "dist-installer", "win-unpacked");
const executable = path.join(unpacked, "Vision Engine.exe");
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package.json"), "utf-8")).version;
const requireFromRuntime = createRequire(path.join(unpacked, "resources", "vision-engine", "webapp", "package.json"));
const { WebSocket } = requireFromRuntime("ws");
if (!fs.existsSync(executable)) throw new Error(`최종 Electron 실행 파일을 찾지 못했습니다: ${executable}`);

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP 오류"));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || "renderer 평가 실패");
    return result?.result?.value;
  }

  close() {
    try { this.socket.close(); } catch { /* noop */ }
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-status-center-smoke-"));
const openclawDir = path.join(temp, ".openclaw");
const configFile = path.join(openclawDir, "openclaw.json");
const token = `ve-status-center-smoke-${Date.now()}`;
let appProcess;
let cdp;

try {
  const [runtimePort, debugPort] = await Promise.all([freePort(), freePort()]);
  fs.mkdirSync(openclawDir, { recursive: true });
  fs.writeFileSync(configFile, `${JSON.stringify({
    secrets: { providers: { default: { source: "store" } } },
    gateway: { port: 18789, auth: { mode: "token", token } },
    agents: { list: [] },
  }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });

  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`], {
    cwd: unpacked,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      VE_USER_DATA_DIR: path.join(temp, "user-data"),
      VE_RUNTIME_PORT: String(runtimePort),
      VE_SKIP_OPENCLAW_SETUP: "1",
      VE_SKIP_OPENCLAW_GATEWAY: "1",
      VE_DISABLE_UPDATES: "1",
      VE_OPENCLAW_HOME: temp,
      OPENCLAW_STATE_DIR: openclawDir,
      OPENCLAW_CONFIG_PATH: configFile,
    },
  });
  let processOutput = "";
  appProcess.stdout?.on("data", (chunk) => { processOutput = `${processOutput}${chunk}`.slice(-8_000); });
  appProcess.stderr?.on("data", (chunk) => { processOutput = `${processOutput}${chunk}`.slice(-8_000); });

  const targetDeadline = Date.now() + 45_000;
  let target;
  while (Date.now() < targetDeadline) {
    await delay(400);
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      target = targets.find((item) => item.type === "page" && String(item.url || "").startsWith(`http://127.0.0.1:${runtimePort}`));
      if (target?.webSocketDebuggerUrl) break;
    } catch { /* 앱 준비 중 */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Electron renderer를 찾지 못했습니다: ${processOutput.slice(-500)}`);

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  const bridge = await cdp.evaluate(`({
    audit: typeof window.veDesktop?.auditOpenClawSecrets,
    update: typeof window.veDesktop?.getUpdateState,
    claudeLogin: typeof window.veDesktop?.claudeLogin,
    version: document.title,
  })`);
  if (bridge?.audit !== "function" || bridge?.update !== "function" || bridge?.claudeLogin !== "function") {
    throw new Error(`Electron preload 상태센터 브리지가 없습니다: ${JSON.stringify(bridge)}`);
  }

  const buttonDeadline = Date.now() + 15_000;
  let clickResult = false;
  let visibleText = "";
  while (Date.now() < buttonDeadline && !clickResult) {
    await delay(300);
    const state = await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll("button")];
      const choice = buttons.find((item) => item.textContent?.includes("PC 앱 준비 확인"));
      if (choice) {
        choice.click();
        return { entered: true, text: document.body?.innerText || "" };
      }
      const opener = buttons.find((item) => item.textContent?.includes("PC 준비"));
      if (opener) opener.click();
      return { entered: false, text: document.body?.innerText || "", opened: Boolean(opener) };
    })()`);
    clickResult = state?.entered === true;
    visibleText = state?.text || "";
  }
  if (!clickResult) throw new Error(`상태센터 진입 버튼을 찾지 못했습니다: ${visibleText.slice(0, 300)}`);

  const updateState = await cdp.evaluate("window.veDesktop.getUpdateState()");
  const uiDeadline = Date.now() + 60_000;
  let snapshot;
  while (Date.now() < uiDeadline) {
    await delay(500);
    snapshot = { text: await cdp.evaluate("document.body.innerText"), update: updateState };
    const update = updateState;
    if (snapshot.text.includes("Vision Engine 시스템 상태센터")
      && snapshot.text.includes("비밀정보 보호")
      && snapshot.text.includes("기본 AI 실행 방식")
      && snapshot.text.includes("Claude Code · 총괄")
      && snapshot.text.includes("Codex · 코딩")
      && snapshot.text.includes("평문 비밀값 1개를 보호해야 합니다.")
      && update?.currentVersion === expectedVersion) {
      break;
    }
  }

  if (!snapshot?.text?.includes("Vision Engine 시스템 상태센터")) throw new Error(`상태센터 제목이 렌더되지 않았습니다: ${String(snapshot?.text || "").slice(0, 300)}`);
  if (!snapshot.text.includes("비밀정보 보호")) throw new Error("비밀정보 보호 카드가 렌더되지 않았습니다.");
  if (!snapshot.text.includes("기본 AI 실행 방식") || !snapshot.text.includes("Claude Code · 총괄") || !snapshot.text.includes("Codex · 코딩")) {
    throw new Error("구독 AI 상태 카드가 렌더되지 않았습니다.");
  }
  if (!snapshot.text.includes("평문 비밀값 1개를 보호해야 합니다.")) {
    const logFile = path.join(temp, "user-data", "logs", "vision-engine.log");
    const diagnostics = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf-8").slice(-2_000).replaceAll(token, "[REDACTED]")
      : "진단 로그 없음";
    throw new Error(`읽기 전용 평문 감사 문구가 올바르지 않습니다: ${snapshot.text.slice(0, 500)}\n${diagnostics}`);
  }
  if (snapshot.update?.currentVersion !== expectedVersion) throw new Error(`상태센터 앱 버전 불일치: ${JSON.stringify(snapshot.update)}`);
  if (JSON.stringify(snapshot).includes(token)) throw new Error("renderer 상태에 비밀 원문이 노출됐습니다.");

  console.log("✅ 데스크톱 상태센터 smoke 통과: 구독 AI 상태 → preload IPC → 읽기 전용 감사 → 실시간 업데이트 상태");
} finally {
  cdp?.close();
  try { appProcess?.kill(); } catch { /* noop */ }
  await delay(800);
  fs.rmSync(temp, { recursive: true, force: true });
}
