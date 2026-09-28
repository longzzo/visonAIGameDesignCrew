// Vision Engine 4 데스크톱 셸
// 두 가지 모드:
//   · 서버 PC(이 노트북): 로컬 서버를 재사용/자동 기동해서 로드
//   · 클라이언트 PC(다른 컴퓨터): 설정된 서버 주소(예: 노트북의 Tailscale 주소)로 접속
// 서버 주소는 첫 실행 설정 화면 또는 연결 실패 시 설정 화면에서 저장한다.
const { app, BrowserWindow, shell, Menu, ipcMain, Tray, globalShortcut, nativeImage, dialog, session, utilityProcess } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { fileURLToPath } = require("node:url");
const { createPreUpdateProjectBackup } = require("./update-backup.cjs");

// 패키지 E2E/기업 배포 검증은 실제 사용자 데이터와 완전히 분리된 경로에서 실행한다.
// 일반 실행에서는 이 환경변수가 없으므로 기존 Electron userData 경로를 그대로 쓴다.
if (process.env.VE_USER_DATA_DIR) {
  const requestedUserData = path.resolve(process.env.VE_USER_DATA_DIR);
  const volumeRoot = path.parse(requestedUserData).root;
  if (!path.isAbsolute(process.env.VE_USER_DATA_DIR) || requestedUserData === volumeRoot) {
    throw new Error("VE_USER_DATA_DIR은 드라이브 루트가 아닌 절대 경로여야 합니다.");
  }
  fs.mkdirSync(requestedUserData, { recursive: true });
  app.setPath("userData", requestedUserData);
}

let tray = null;
let quitting = false;
let diagnosticLogFile = "";
let updateState = { status: "disabled", version: "", progress: 0, message: "업데이트 서버가 설정되지 않았습니다." };
let updateCheckInProgress = false;
let updatePromptRequested = false;
let updateBackupPromise = null;
let downloadedUpdateInfo = null;

const configuredRuntimePort = Number(process.env.VE_RUNTIME_PORT || 5199);
const RUNTIME_PORT = Number.isInteger(configuredRuntimePort) && configuredRuntimePort >= 1024 && configuredRuntimePort <= 65535 ? configuredRuntimePort : 5199;
const LOCAL_URL = `http://127.0.0.1:${RUNTIME_PORT}`;
const desktopDataRoot = () => path.join(app.getPath("userData"), "vision-engine-data");

const logText = (value) => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};

function initDiagnostics() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  diagnosticLogFile = path.join(dir, "vision-engine.log");
  try {
    if (fs.statSync(diagnosticLogFile).size > 5 * 1024 * 1024) {
      const previous = path.join(dir, "vision-engine.previous.log");
      if (fs.existsSync(previous)) fs.rmSync(previous, { force: true });
      fs.renameSync(diagnosticLogFile, previous);
    }
  } catch { /* 첫 실행 */ }
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try { fs.appendFileSync(diagnosticLogFile, `${new Date().toISOString()} ${level.toUpperCase()} ${args.map(logText).join(" ")}\n`, "utf-8"); } catch { /* 로그 실패가 앱을 막으면 안 됨 */ }
    };
  }
  process.on("uncaughtException", (error) => console.error("처리되지 않은 예외:", error));
  process.on("unhandledRejection", (error) => console.error("처리되지 않은 Promise 거부:", error));
  console.log(`Vision Engine ${app.getVersion()} 진단 로그 시작`);
}

/** 설치본에 포함된 독립 실행 Studio 런타임. 개발 중에는 null. */
function packagedStudio() {
  if (!app.isPackaged) return null;
  const root = path.join(process.resourcesPath, "vision-engine");
  const runtime = path.join(root, "webapp", "dist-server", "runtime.mjs");
  return fs.existsSync(runtime) ? { root, runtime, webapp: path.join(root, "webapp") } : null;
}

/** 앱 버전별 1회 안전 병합한다. 워크스페이스는 설치 리소스가 아닌 쓰기 가능한 데이터 폴더에 둔다. */
async function ensurePackagedOpenclaw(studio) {
  if (process.env.VE_SKIP_OPENCLAW_SETUP === "1") return false;
  const marker = path.join(desktopDataRoot(), "openclaw-setup.json");
  try {
    const done = JSON.parse(fs.readFileSync(marker, "utf-8"));
    if (done.version === app.getVersion()) return false;
  } catch { /* 최초 설치 또는 새 앱 버전 */ }
  const sourceAgents = path.join(studio.root, "agents");
  const targetAgents = path.join(desktopDataRoot(), "agents");
  if (fs.existsSync(sourceAgents)) {
    fs.mkdirSync(targetAgents, { recursive: true });
    fs.cpSync(sourceAgents, targetAgents, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
  }
  const setup = path.join(studio.root, "scripts", "setup-openclaw.mjs");
  if (!fs.existsSync(setup)) return false;
  let result;
  try {
    result = await runUtilityModule(setup, [], {
      cwd: studio.root,
      env: externalAiEnv({ VE_AGENT_REPO: desktopDataRoot() }),
      serviceName: "Vision Engine OpenClaw Setup",
    });
  } catch (error) {
    console.warn("⚠️ OpenClaw 초기 설정 실행 실패:", String(error?.message || error).slice(0, 500));
    return false;
  }
  if (result.code !== 0) {
    console.warn("⚠️ OpenClaw 초기 설정 실패:", String(result.stderr || result.stdout || `종료 코드 ${result.code}`).slice(0, 500));
    return false;
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ version: app.getVersion(), updatedAt: Date.now() }, null, 2));
  return true;
}

async function protectOpenClawSecrets() {
  const studio = packagedStudio();
  const root = studio?.root || path.resolve(__dirname, "..");
  const script = path.join(root, "scripts", "migrate-openclaw-secrets.mjs");
  const entry = findOpenClawEntry();
  if (!fs.existsSync(script) || !entry) return { ok: false, error: "OpenClaw 또는 비밀키 이전 도구를 찾지 못했습니다." };
  try {
    const migration = await runNodeModule(script, [], {
      cwd: root,
      env: externalAiEnv({ VE_RUN_SECRET_MIGRATION: "1", VE_OPENCLAW_ENTRY: entry }),
      timeoutMs: 180_000,
    });
    const line = String(migration.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
    const result = line ? JSON.parse(line) : null;
    if (migration.code !== 0 || !result?.ok) {
      return { ok: false, error: safeRuntimeOutput(migration.stderr || migration.stdout || "비밀키 이전 감사가 완료되지 않았습니다.") };
    }
    await tryStartOpenClawGateway(true);
    return result;
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 500) };
  }
}

async function auditOpenClawSecretProtection() {
  const studio = packagedStudio();
  const root = studio?.root || path.resolve(__dirname, "..");
  const script = path.join(root, "scripts", "migrate-openclaw-secrets.mjs");
  const entry = findOpenClawEntry();
  if (!fs.existsSync(script) || !entry) {
    return { ok: false, status: "unavailable", error: "OpenClaw 또는 비밀키 감사 도구를 찾지 못했습니다." };
  }
  try {
    const audit = await runNodeModule(script, [], {
      cwd: root,
      env: externalAiEnv({ VE_RUN_SECRET_AUDIT_ONLY: "1", VE_OPENCLAW_ENTRY: entry }),
      timeoutMs: 60_000,
    });
    const line = String(audit.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
    const result = line ? JSON.parse(line) : null;
    if (!result || (audit.code !== 0 && result.status !== "action-required")) {
      return { ok: false, status: "unavailable", error: "비밀정보 감사를 완료하지 못했습니다. 진단 보고서를 확인하세요." };
    }
    return result;
  } catch (error) {
    console.warn("⚠️ OpenClaw 비밀정보 감사 실패:", String(error?.message || error).slice(0, 300));
    return { ok: false, status: "unavailable", error: "비밀정보 감사를 완료하지 못했습니다. 진단 보고서를 확인하세요." };
  }
}

function runUtilityModule(modulePath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = utilityProcess.fork(modulePath, args, {
        cwd: options.cwd,
        env: options.env,
        serviceName: options.serviceName || "Vision Engine Worker",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const append = (current, chunk) => `${current}${String(chunk || "")}`.slice(-20_000);
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish(() => reject(new Error(`Utility Process 제한 시간 초과 (${options.timeoutMs || 45_000}ms)`)));
    }, options.timeoutMs || 45_000);
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (type, location) => { stderr = append(stderr, `${type}: ${location}`); });
    child.once("exit", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

/** OpenClaw는 하위 Node worker를 실행하므로 RunAsNode가 꺼진 Electron UtilityProcess에서 실행하지 않는다. */
function findNodeRuntime() {
  const candidates = [
    process.env.VE_NODE_EXECUTABLE,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs", "node.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe"),
  ].filter(Boolean);
  const direct = candidates.find((file) => fs.existsSync(file));
  if (direct) return direct;
  if (process.platform === "win32") {
    const found = spawnSync("where.exe", ["node.exe"], { encoding: "utf-8", windowsHide: true });
    if (found.status === 0) {
      return String(found.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    }
  }
  return "";
}

/** Codex/Claude 샌드박스의 가상 npm 경로가 일반 데스크톱 AI 런타임에 전파되지 않게 한다. */
function externalAiEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (/^CODEX_/i.test(key)) delete env[key];
  }
  for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "NPM_CONFIG_PREFIX"]) delete env[key];
  if (process.platform === "win32") {
    env.APPDATA = path.join(os.homedir(), "AppData", "Roaming");
    env.LOCALAPPDATA = path.join(os.homedir(), "AppData", "Local");
  }
  return env;
}

function runNodeModule(modulePath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const nodeRuntime = options.nodeRuntime || findNodeRuntime();
    if (!nodeRuntime) {
      reject(new Error("OpenClaw 실행에 필요한 Node.js를 찾지 못했습니다."));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = spawn(nodeRuntime, [modulePath, ...args], {
        cwd: options.cwd,
        env: options.env || externalAiEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const append = (current, chunk) => `${current}${String(chunk || "")}`.slice(-20_000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish(() => reject(new Error(`Node 프로세스 제한 시간 초과 (${options.timeoutMs || 45_000}ms)`)));
    }, options.timeoutMs || 45_000);
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

function hasProjects(root) {
  const dir = path.join(root, "workspace", "projects");
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "project.json")));
  } catch { return false; }
}

/** 설치 전 체크아웃의 사용자 데이터만 새 앱 데이터 폴더로 비파괴 이전한다. */
function migratePackagedDataIfEmpty(studio) {
  if (!app.isPackaged || process.env.VE_SKIP_DATA_MIGRATION === "1" || hasProjects(desktopDataRoot())) return null;
  const cfg = loadConfig();
  const candidates = [
    cfg.repoDir,
    process.env.VE_REPO,
    "D:\\Claude\\vision-engine\\vision-engine",
    path.join(os.homedir(), "vision-engine"),
  ].filter(Boolean).map((value) => path.resolve(value));
  const source = candidates.find((root) => root !== studio.root && hasProjects(root));
  if (!source) return null;
  const target = desktopDataRoot();
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(source, "workspace"), path.join(target, "workspace"), {
    recursive: true, force: false, errorOnExist: false, preserveTimestamps: true,
  });
  const copied = ["workspace"];
  for (const name of ["custom-agents.json", "agent-growth.json", "unity.local.json", "notion.json", "notion-map.json", "naver.json"]) {
    const from = path.join(source, "config", name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, "config", name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) { fs.copyFileSync(from, to); copied.push(`config/${name}`); }
  }
  fs.writeFileSync(path.join(target, "migration.json"), JSON.stringify({ source, target, copied, importedAt: Date.now(), automatic: true }, null, 2));
  console.log("✅ 기존 프로젝트 데이터 비파괴 이전:", source, "→", target);
  return source;
}

function findOpenClawEntry() {
  const candidates = [
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || "";
}

const waitForLocalPort = (port, timeoutMs = 8_000) => new Promise((resolve) => {
  const startedAt = Date.now();
  const probe = () => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let finished = false;
    const done = (open) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (open) resolve(true);
      else if (Date.now() - startedAt >= timeoutMs) resolve(false);
      else setTimeout(probe, 250);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  };
  probe();
});

let gatewayChild = null;
let gatewayStartPromise = null;
let gatewayRestartTimer = null;
let gatewayRestartAttempts = 0;

function pipeGatewayDiagnostics(child) {
  child.stdout?.on("data", (chunk) => {
    const message = safeRuntimeOutput(chunk);
    if (message) console.log(`[openclaw] ${message}`);
  });
  child.stderr?.on("data", (chunk) => {
    const message = safeRuntimeOutput(chunk);
    if (message) console.warn(`[openclaw] ${message}`);
  });
}

function scheduleGatewayRestart(exitCode) {
  if (quitting || gatewayRestartTimer) return;
  gatewayRestartAttempts += 1;
  if (gatewayRestartAttempts > 6) {
    console.warn(`⚠️ OpenClaw Gateway 자동 복구를 중단합니다. 앱의 AI 상태에서 다시 시작할 수 있습니다. (code=${exitCode})`);
    return;
  }
  const delay = Math.min(30_000, 1_500 * (2 ** Math.min(gatewayRestartAttempts - 1, 5)));
  console.warn(`⚠️ OpenClaw Gateway 자동 복구 예약: ${delay}ms 후 재시작 (code=${exitCode})`);
  gatewayRestartTimer = setTimeout(() => {
    gatewayRestartTimer = null;
    if (!quitting) void tryStartOpenClawGateway(false);
  }, delay);
}

function spawnManagedOpenClawGateway(entry) {
  const nodeRuntime = findNodeRuntime();
  if (!nodeRuntime) throw new Error("OpenClaw Gateway 실행에 필요한 Node.js를 찾지 못했습니다.");
  const child = spawn(nodeRuntime, [entry, "gateway", "run", "--port", "18789", "--force"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: externalAiEnv(),
    shell: false,
    windowsHide: true,
  });
  gatewayChild = child;
  pipeGatewayDiagnostics(child);
  child.once("error", (error) => console.warn("⚠️ OpenClaw Gateway Node 프로세스 오류:", String(error?.message || error)));
  child.once("exit", (code) => {
    if (gatewayChild !== child) return;
    gatewayChild = null;
    console.warn(`⚠️ OpenClaw Gateway 종료: code=${code}, quitting=${quitting}`);
    if (!quitting) scheduleGatewayRestart(code);
  });
  return child;
}

/** 서비스가 있으면 재사용하고, 없으면 앱이 Gateway를 직접 상주시켜 자동 복구한다. */
async function startOpenClawGateway(restart = false) {
  if (process.platform !== "win32" || process.env.VE_SKIP_OPENCLAW_GATEWAY === "1") {
    return { ok: false, error: "격리 실행에서는 Gateway를 시작하지 않습니다." };
  }
  const entry = findOpenClawEntry();
  if (!entry) return { ok: false, error: "OpenClaw 설치를 찾지 못했습니다. PC 준비에서 OpenClaw를 먼저 설치하세요." };

  if (!restart && await waitForLocalPort(18789, 700)) {
    gatewayRestartAttempts = 0;
    return { ok: true, mode: gatewayChild ? "managed" : "service" };
  }

  if (gatewayChild) {
    const child = gatewayChild;
    gatewayChild = null;
    try { child.kill(); } catch { /* 이미 종료됨 */ }
  }

  // 이미 떠 있는 예약 작업은 위 포트 검사에서 재사용한다. 기본 시작은 앱 관리 모드로 직행한다.
  // OpenClaw CLI의 service start가 별도 진단 worker를 남기면 직접 Gateway와 SQLite 잠금을 다투기 때문이다.
  if (process.env.VE_USE_OPENCLAW_SERVICE === "1") {
    try {
      const service = await runNodeModule(entry, ["gateway", restart ? "restart" : "start"], {
        env: externalAiEnv(),
        timeoutMs: 45_000,
      });
      if (service.code === 0 && await waitForLocalPort(18789, 10_000)) {
        gatewayRestartAttempts = 0;
        console.log(`✅ OpenClaw Gateway 서비스 ${restart ? "재시작" : "시작"} 확인`);
        return { ok: true, mode: "service" };
      }
      const detail = safeRuntimeOutput(service.stderr || service.stdout);
      if (detail) console.warn("⚠️ OpenClaw 서비스 시작 불가, 앱 관리 모드로 전환:", detail);
    } catch (error) {
      console.warn("⚠️ OpenClaw 서비스 제어 실패, 앱 관리 모드로 전환:", String(error?.message || error).slice(0, 300));
    }
  }

  try {
    spawnManagedOpenClawGateway(entry);
    if (await waitForLocalPort(18789, 120_000)) {
      gatewayRestartAttempts = 0;
      console.log("✅ OpenClaw Gateway 앱 관리 모드 기동 확인");
      return { ok: true, mode: "managed" };
    }
    // 초기 DB 정리·플러그인 인덱싱에 2분을 준다. 그 뒤에도 포트가 없으면 자동 triage가
    // 남아 있는 경우까지 프로세스를 정리하고 새 상태로 재시도한다.
    if (gatewayChild) {
      const child = gatewayChild;
      gatewayChild = null;
      try { child.kill(); } catch { /* 이미 종료됨 */ }
      if (!quitting) scheduleGatewayRestart("readiness-timeout");
      return { ok: false, retrying: true, error: "OpenClaw Gateway 준비 시간이 초과되어 백그라운드에서 다시 시작합니다." };
    }
    if (!quitting) scheduleGatewayRestart("readiness-timeout");
    return { ok: false, error: "OpenClaw Gateway 프로세스가 준비 전에 종료되었습니다. 진단 로그를 확인하세요." };
  } catch (error) {
    if (!quitting) scheduleGatewayRestart("spawn-error");
    return { ok: false, error: `OpenClaw Gateway 실행 실패: ${String(error?.message || error).slice(0, 200)}` };
  }
}

function tryStartOpenClawGateway(restart = false) {
  if (gatewayStartPromise) return gatewayStartPromise;
  gatewayStartPromise = startOpenClawGateway(restart).finally(() => { gatewayStartPromise = null; });
  return gatewayStartPromise;
}

function findOpenClawCli() {
  if (process.platform !== "win32") return "openclaw";
  const candidates = [
    path.join(os.homedir(), "AppData", "Roaming", "npm", "openclaw.cmd"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "openclaw.cmd"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "openclaw.ps1"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "npm", "openclaw.cmd"),
  ].filter(Boolean);
  const direct = candidates.find((file) => fs.existsSync(file));
  if (direct) return direct;
  for (const command of ["openclaw.cmd", "openclaw.exe", "openclaw"]) {
    const result = spawnSync("where.exe", [command], { windowsHide: true, encoding: "utf-8" });
    const found = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (result.status === 0 && found) return found;
  }
  return "";
}

function findOllamaCli() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
  ].filter(Boolean);
  const direct = candidates.find((file) => fs.existsSync(file));
  if (direct) return direct;
  const found = spawnSync("where.exe", ["ollama.exe"], { windowsHide: true, encoding: "utf-8" });
  return found.status === 0 ? String(found.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "" : "";
}

function findCodexNativeExecutable() {
  const webapp = findWebappDir();
  if (!webapp) return "";
  const platformInfo = process.platform === "win32"
    ? { packageName: `codex-win32-${process.arch}`, triple: process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc", binary: "codex.exe" }
    : null;
  if (!platformInfo) return "";
  const direct = path.join(webapp, "node_modules", "@openai", platformInfo.packageName, "vendor", platformInfo.triple, "bin", platformInfo.binary);
  return fs.existsSync(direct) ? direct : "";
}

function findClaudeExecutable() {
  const candidates = [
    process.env.VE_CLAUDE_CLI,
    process.platform === "win32" ? path.join(os.homedir(), ".local", "bin", "claude.exe") : "",
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "claude.cmd"),
    process.platform === "win32" ? path.join(os.homedir(), "AppData", "Roaming", "npm", "claude.cmd") : "",
    process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "Programs", "claude", "claude.exe") : "",
  ].filter(Boolean);
  const direct = candidates.find((file) => fs.existsSync(file));
  if (direct) return direct;
  if (process.platform === "win32") {
    for (const command of ["claude.exe", "claude.cmd", "claude"]) {
      const result = spawnSync("where.exe", [command], { windowsHide: true, encoding: "utf-8" });
      const found = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (result.status === 0 && found) return found;
    }
  }
  return process.platform === "win32" ? "" : "claude";
}

function launchOllamaPull(model = "qwen3.5:4b") {
  if (!/^[a-zA-Z0-9_.:/-]+$/.test(model)) return { ok: false, error: "올바르지 않은 모델 이름입니다." };
  const cli = findOllamaCli();
  if (!cli) return { ok: false, error: "Ollama를 찾지 못했습니다. ollama.com에서 먼저 설치하세요." };
  try {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NoExit", "-Command",
      "& $env:VE_OLLAMA_CLI pull $env:VE_OLLAMA_MODEL; Write-Host ''; Write-Host '모델 설치가 끝났습니다. Vision Engine에서 다시 확인을 누르세요.'",
    ], { windowsHide: false, detached: true, stdio: "ignore", env: { ...process.env, VE_OLLAMA_CLI: cli, VE_OLLAMA_MODEL: model } });
    child.unref();
    return { ok: true, model };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

function launchOpenClawOnboard() {
  const cli = findOpenClawCli();
  if (!cli) return { ok: false, error: "OpenClaw CLI가 설치되어 있지 않습니다. 먼저 `npm install -g openclaw`를 실행하세요." };
  try {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NoExit", "-Command",
      "& $env:VE_OPENCLAW_CLI onboard; Write-Host ''; Write-Host '온보딩이 끝나면 이 창을 닫고 Vision Engine에서 Gateway 시작을 누르세요.'",
    ], { windowsHide: false, detached: true, stdio: "ignore", env: externalAiEnv({ VE_OPENCLAW_CLI: cli }) });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

function launchOpenClawSecrets() {
  const cli = findOpenClawCli();
  if (!cli) return { ok: false, error: "OpenClaw CLI가 설치되어 있지 않습니다. 먼저 `npm install -g openclaw`를 실행하세요." };
  try {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NoExit", "-Command",
      "& $env:VE_OPENCLAW_CLI secrets configure; Write-Host ''; Write-Host '비밀키 설정이 끝나면 이 창을 닫으세요.'",
    ], { windowsHide: false, detached: true, stdio: "ignore", env: externalAiEnv({ VE_OPENCLAW_CLI: cli }) });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

/**
 * webapp 폴더 탐색 — 설치된 앱은 __dirname이 resources/app이라 ../webapp이 없다.
 * 후보: 설정(repoDir) → 환경변수 → 개발 체크아웃(../webapp) → 알려진 설치 경로.
 */
function findWebappDir() {
  const cfg = loadConfig();
  const candidates = [
    packagedStudio()?.webapp,
    cfg.repoDir && path.join(cfg.repoDir, "webapp"),
    process.env.VE_REPO && path.join(process.env.VE_REPO, "webapp"),
    path.resolve(__dirname, "..", "webapp"),
    "D:\\Claude\\vision-engine\\vision-engine\\webapp",
    path.join(os.homedir(), "vision-engine", "webapp"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "dist-server", "runtime.mjs"))) return dir;
    } catch {
      /* noop */
    }
  }
  return null;
}

let serverChild = null; // 우리가 띄운 경우에만 종료 시 정리
let spawnedTarget = null; // 우리가 띄운 서버가 실제로 응답한 주소 (tailnet 모드면 127.0.0.1이 아니다)
let runtimeRestartTimer = null;
let runtimeRestartAttempts = 0;
let runtimeRestarting = false;
let runtimeSpawnedAt = 0;
let win = null;
let splashWin = null;
let currentTarget = LOCAL_URL;

function sameOrigin(candidate, expected = currentTarget) {
  try { return new URL(candidate).origin === new URL(expected).origin; } catch { return false; }
}

function openSafeExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch { return false; }
}

const configFile = () => path.join(app.getPath("userData"), "config.json");
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf-8"));
  } catch {
    return {};
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), "utf-8");
}

function loadProductConfig() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "vision-engine", "config", "product.json")
    : path.resolve(__dirname, "..", "config", "product.json");
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return {}; }
}

function publicUpdateState() {
  return {
    status: String(updateState.status || "disabled"),
    version: String(updateState.version || ""),
    progress: Number(updateState.progress || 0),
    message: String(updateState.message || "").slice(0, 300),
    currentVersion: app.getVersion(),
    backupReady: updateState.backupReady === true,
    backupName: String(updateState.backupName || "").slice(0, 180),
  };
}

function setUpdateState(next) {
  updateState = { ...updateState, ...next };
  refreshTrayMenu();
}

async function promptForUpdate(info) {
  const version = String(info?.version || updateState.version || "새 버전");
  const answer = await dialog.showMessageBox(win, {
    type: "info",
    title: "Vision Engine 업데이트",
    message: `Vision Engine ${version} 업데이트가 있습니다.`,
    detail: "백그라운드에서 내려받은 뒤 설치할 수 있습니다.",
    buttons: ["다운로드", "나중에"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (answer.response !== 0) return;
  setUpdateState({ status: "downloading", version, progress: 0, message: `${version} 다운로드를 시작합니다.` });
  try { await autoUpdater.downloadUpdate(); }
  catch (error) { setUpdateState({ status: "error", message: `다운로드 실패: ${String(error?.message || error).slice(0, 180)}` }); }
}

function configuredRemoteServerUrl() {
  const value = String(loadConfig()?.serverUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ? "" : value;
  } catch { return value; }
}

function prepareDownloadedUpdate(info) {
  if (updateBackupPromise) return updateBackupPromise;
  const version = String(info?.version || updateState.version || "새 버전");
  updateBackupPromise = (async () => {
    autoUpdater.autoInstallOnAppQuit = false;
    setUpdateState({ status: "backing-up", version, progress: 100, backupReady: false, backupName: "", message: "업데이트 전 프로젝트를 자동 백업하고 있습니다…" });
    try {
      const backup = await createPreUpdateProjectBackup({
        userDataDir: app.getPath("userData"),
        runtimePort: RUNTIME_PORT,
        currentVersion: app.getVersion(),
        targetVersion: version,
        remoteServerUrl: configuredRemoteServerUrl(),
      });
      const detail = backup.created
        ? `프로젝트 ${backup.projects}개를 ${backup.name}에 백업했습니다.\n${backup.file}`
        : backup.reason === "remote-client"
          ? "프로젝트가 원격 서버에 있어 이 PC에서는 백업을 건너뜁니다. 서버 PC의 백업 정책을 확인하세요."
          : "아직 프로젝트가 없어 백업 없이 안전하게 업데이트할 수 있습니다.";
      setUpdateState({
        status: "ready",
        version,
        progress: 100,
        backupReady: backup.created || backup.reason === "no-projects" || backup.reason === "remote-client",
        backupName: backup.name || "",
        message: backup.created ? "업데이트 백업과 설치 준비가 끝났습니다." : "업데이트 설치 준비가 끝났습니다.",
      });
      const answer = await dialog.showMessageBox(win, {
        type: "info",
        title: "Vision Engine 업데이트",
        message: "업데이트 설치 준비가 끝났습니다.",
        detail,
        buttons: ["지금 재시작", "종료할 때 설치"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (answer.response === 0) {
        quitting = true;
        autoUpdater.quitAndInstall(false, true);
        return;
      }
      autoUpdater.autoInstallOnAppQuit = true;
      setUpdateState({ status: "scheduled", message: "앱을 종료할 때 업데이트를 설치합니다.", backupReady: true });
    } catch (error) {
      const message = `업데이트 전 자동 백업 실패: ${String(error?.message || error).slice(0, 180)}`;
      console.warn(message);
      setUpdateState({ status: "backup-error", version, progress: 100, backupReady: false, backupName: "", message });
      const answer = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Vision Engine 업데이트 보류",
        message: "프로젝트 자동 백업에 실패해 업데이트 설치를 보류했습니다.",
        detail: `${message}\n\n프로젝트를 보호하기 위해 백업 없이 자동 설치하지 않습니다.`,
        buttons: ["백업 다시 시도", "업데이트 취소"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (answer.response === 0) setTimeout(() => { void prepareDownloadedUpdate(info); }, 0);
    }
  })().finally(() => { updateBackupPromise = null; });
  return updateBackupPromise;
}

function configureAutoUpdater() {
  const product = loadProductConfig();
  const updateUrl = String(product.updateUrl || "").trim();
  if (process.env.VE_DISABLE_UPDATES === "1") {
    setUpdateState({ status: "disabled", message: "관리자 정책으로 자동 업데이트가 꺼져 있습니다." });
    return;
  }
  if (!app.isPackaged) {
    setUpdateState({ status: "disabled", message: "개발 모드에서는 자동 업데이트를 사용하지 않습니다." });
    return;
  }
  if (!/^https:\/\//i.test(updateUrl)) {
    setUpdateState({ status: "disabled", message: "업데이트 배포 주소가 아직 설정되지 않았습니다." });
    return;
  }
  if (product.updatesEnabled !== true) {
    setUpdateState({ status: "disabled", message: "첫 업데이트 채널 게시 전입니다." });
    return;
  }
  autoUpdater.autoDownload = false;
  // 업데이트 전 프로젝트 백업이 성공한 뒤에만 종료 시 설치를 허용한다.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
  setUpdateState({ status: "idle", message: "업데이트 확인 준비됨" });

  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", message: "업데이트를 확인하고 있습니다…" }));
  autoUpdater.on("update-available", (info) => {
    downloadedUpdateInfo = null;
    setUpdateState({ status: "available", version: String(info?.version || ""), backupReady: false, backupName: "", message: "새 업데이트가 있습니다." });
    void promptForUpdate(info);
  });
  autoUpdater.on("update-not-available", () => {
    setUpdateState({ status: "current", progress: 0, message: "최신 버전을 사용 중입니다." });
    if (updatePromptRequested) void dialog.showMessageBox(win, { type: "info", title: "Vision Engine 업데이트", message: "최신 버전을 사용 중입니다.", buttons: ["확인"] });
  });
  autoUpdater.on("download-progress", (progress) => setUpdateState({
    status: "downloading",
    progress: Math.max(0, Math.min(100, Math.round(Number(progress?.percent || 0)))),
    message: `업데이트 다운로드 중 · ${Math.round(Number(progress?.percent || 0))}%`,
  }));
  autoUpdater.on("update-downloaded", (info) => {
    downloadedUpdateInfo = info;
    void prepareDownloadedUpdate(info);
  });
  autoUpdater.on("error", (error) => {
    const message = `업데이트 확인 실패: ${String(error?.message || error).slice(0, 180)}`;
    console.warn(message);
    setUpdateState({ status: "error", message });
    if (updatePromptRequested) void dialog.showMessageBox(win, { type: "warning", title: "Vision Engine 업데이트", message, buttons: ["확인"] });
  });
}

async function checkForUpdates(userInitiated = false) {
  if (updateState.status === "disabled") return { ok: false, ...publicUpdateState() };
  if (updateState.status === "backup-error" && downloadedUpdateInfo) {
    await prepareDownloadedUpdate(downloadedUpdateInfo);
    return { ok: updateState.status !== "backup-error", ...publicUpdateState() };
  }
  if (updateCheckInProgress) return { ok: true, ...publicUpdateState() };
  updateCheckInProgress = true;
  updatePromptRequested = Boolean(userInitiated);
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, ...publicUpdateState() };
  } catch (error) {
    return { ok: false, ...publicUpdateState(), message: String(error?.message || error).slice(0, 180) };
  } finally {
    updateCheckInProgress = false;
    updatePromptRequested = false;
  }
}

function safeOpenClawSummary() {
  const file = path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
    const entries = cfg?.agents?.entries && typeof cfg.agents.entries === "object" ? Object.keys(cfg.agents.entries) : [];
    const legacy = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
    const providers = Object.entries(cfg?.models?.providers || {}).map(([name, value]) => ({
      name,
      credentialConfigured: value?.apiKey && (typeof value.apiKey === "object" || String(value.apiKey).length > 8),
    }));
    return {
      configured: true,
      agents: entries.length || legacy.length,
      defaultModel: cfg?.agents?.defaults?.model?.primary || "",
      providers,
      plaintextCredentialsDetected: Boolean(
        typeof cfg?.gateway?.auth?.token === "string"
        || Object.values(cfg?.models?.providers || {}).some((value) => typeof value?.apiKey === "string" && String(value.apiKey).length > 8)
      ),
    };
  } catch {
    return { configured: false, agents: 0, defaultModel: "", providers: [], plaintextCredentialsDetected: false };
  }
}

function getLocalJson(url, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => { if (body.length < 2_000_000) body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.once("error", () => resolve(null));
  });
}

function recentDiagnosticLog() {
  try {
    const data = fs.readFileSync(diagnosticLogFile);
    return data.subarray(Math.max(0, data.length - 200_000)).toString("utf-8");
  } catch { return ""; }
}

async function exportSupportReport() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await dialog.showSaveDialog(win, {
    title: "Vision Engine 진단 보고서 저장",
    defaultPath: path.join(app.getPath("documents"), `VisionEngine-Diagnostics-${stamp}.json`),
    filters: [{ name: "JSON 진단 보고서", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const readiness = await getLocalJson(`${LOCAL_URL}/api/readiness`);
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    application: { name: "Vision Engine", version: app.getVersion(), packaged: app.isPackaged },
    system: { platform: process.platform, arch: process.arch, release: os.release(), totalMemory: os.totalmem() },
    readiness,
    openclaw: safeOpenClawSummary(),
    log: recentDiagnosticLog(),
  };
  fs.writeFileSync(result.filePath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return { ok: true, file: result.filePath };
}

function openDiagnosticFolder() {
  const dir = path.dirname(diagnosticLogFile || path.join(app.getPath("userData"), "logs", "vision-engine.log"));
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}

function ping(base) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL("/api/health", base);
    } catch {
      resolve(false);
      return;
    }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { timeout: 2500 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 이 PC에서 서버가 떠 있을 수 있는 주소 후보.
 *
 * 오너 신고 2026-08-06 "바로가기로 누르면 아직도 안 열린다"의 진짜 원인:
 * `VisionEngine-Start.bat`은 모바일 모드(`npm run dev:mobile`, VE_EXPOSE=tailnet)로 서버를 띄우는데,
 * 그러면 vite가 **Tailscale IP(100.x)에만 배타적으로 바인딩**한다 — `127.0.0.1:5199`는 죽어 있다.
 * 그런데 이 앱은 LOCAL_URL(127.0.0.1) 하나만 확인했다. 그래서
 *   ① ping 실패 → ② "서버가 없구나" 하고 npm run dev를 새로 띄우려 함
 *   → ③ 포트 5199는 이미 사용 중 + vite strictPort:true라 새 서버가 즉사
 *   → ④ 90초를 기다린 뒤 설정 화면. 사용자에겐 "눌러도 안 열린다"로만 보인다.
 * **Start를 먼저 시킬수록 오히려 안 열리는** 역설이 여기서 나온다.
 *
 * 그래서 서버의 노출 설정(보안 정책)은 건드리지 않고, 앱이 tailnet 주소까지 찾아보게 한다.
 * 100.x(CGNAT)만 후보로 삼는다 — 일반 LAN 주소까지 뒤지면 남의 PC에 붙을 수 있다.
 */
function localCandidates() {
  const out = [LOCAL_URL, `http://localhost:${RUNTIME_PORT}`];
  try {
    for (const list of Object.values(os.networkInterfaces() ?? {})) {
      for (const ni of list ?? []) {
        if (ni.family === "IPv4" && !ni.internal && /^100\./.test(ni.address)) {
          out.push(`http://${ni.address}:${RUNTIME_PORT}`);
        }
      }
    }
  } catch {
    /* 인터페이스 조회 실패는 무시 — 기본 후보만 쓴다 */
  }
  return [...new Set(out)];
}

function safeRuntimeOutput(value) {
  return String(value || "")
    .replace(/\b(?:sk-(?:proj-)?|ghp_|github_pat_|nvapi-|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .trim()
    .slice(-4_000);
}

function pipeRuntimeDiagnostics(child) {
  child.stdout?.on("data", (chunk) => {
    const message = safeRuntimeOutput(chunk);
    if (message) console.log(`[studio] ${message}`);
  });
  child.stderr?.on("data", (chunk) => {
    const message = safeRuntimeOutput(chunk);
    if (message) console.warn(`[studio] ${message}`);
  });
}

function scheduleRuntimeRestart(exitCode) {
  if (quitting || runtimeRestartTimer) return;
  if (Date.now() - runtimeSpawnedAt > 60_000) runtimeRestartAttempts = 0;
  runtimeRestartAttempts += 1;
  const delay = Math.min(30_000, 1_500 * (2 ** Math.min(runtimeRestartAttempts - 1, 5)));
  console.warn(`⚠️ Studio 런타임 자동 복구 예약: ${delay}ms 후 재시작 (code=${exitCode})`);
  runtimeRestartTimer = setTimeout(async () => {
    runtimeRestartTimer = null;
    if (quitting) return;
    if (runtimeRestarting) {
      scheduleRuntimeRestart("restart-in-progress");
      return;
    }
    runtimeRestarting = true;
    try {
      const running = await findRunningServer();
      if (running) {
        spawnedTarget = running;
        runtimeRestartAttempts = 0;
        return;
      }
      console.log("♻️ Studio 런타임을 자동으로 복구합니다.");
      const recovered = await trySpawnLocalServer();
      if (!recovered) scheduleRuntimeRestart("readiness-timeout");
    } catch (error) {
      console.warn("⚠️ Studio 런타임 자동 복구 실패:", String(error?.message || error).slice(0, 300));
      scheduleRuntimeRestart("restart-error");
    } finally {
      runtimeRestarting = false;
    }
  }, delay);
}

/** 후보 중 실제로 응답하는 첫 주소 (없으면 null) */
async function findRunningServer() {
  for (const url of localCandidates()) {
    if (await ping(url)) {
      console.log("✅ 이미 떠 있는 서버 발견:", url);
      return url;
    }
  }
  return null;
}

/** 로컬 서버가 없고 이 PC에 저장소(webapp)가 있으면 직접 띄운다 */
async function trySpawnLocalServer() {
  const packaged = packagedStudio();
  if (packaged) {
    const openclawChanged = await ensurePackagedOpenclaw(packaged);
    migratePackagedDataIfEmpty(packaged);
    // Gateway 마이그레이션이 길어져도 Studio와 로딩 창은 먼저 사용할 수 있어야 한다.
    void tryStartOpenClawGateway(openclawChanged).then((result) => {
      if (!result?.ok) console.warn("⚠️ OpenClaw Gateway 백그라운드 상태:", result?.error || "준비되지 않음");
    }).catch((error) => console.warn("⚠️ OpenClaw Gateway 백그라운드 기동 실패:", String(error?.message || error)));
    console.log("⏳ 내장 Studio 런타임 기동 중…", packaged.runtime);
    showSplash("Vision Engine Studio를 기동하고 있습니다…");
    try {
      serverChild = utilityProcess.fork(packaged.runtime, [], {
        cwd: path.dirname(packaged.runtime),
        stdio: "ignore",
        serviceName: "Vision Engine Studio Runtime",
        env: {
          ...process.env,
          VE_REPO_ROOT: packaged.root,
          VE_WEBAPP_ROOT: packaged.webapp,
          VE_DATA_ROOT: path.join(app.getPath("userData"), "vision-engine-data"),
          VE_DESKTOP: "1",
          VE_RUNTIME_HOST: "127.0.0.1",
          VE_RUNTIME_PORT: String(RUNTIME_PORT),
        },
      });
      runtimeSpawnedAt = Date.now();
      pipeRuntimeDiagnostics(serverChild);
      serverChild.on("error", (type, location) => console.warn("⚠️ 내장 런타임 기동 실패:", type, location));
      serverChild.on("exit", (code) => {
        console.warn(`⚠️ 내장 런타임 종료: code=${code}, quitting=${quitting}`);
        serverChild = null;
        if (!quitting) scheduleRuntimeRestart(code);
      });
    } catch (e) {
      console.warn("⚠️ 내장 런타임 spawn 예외:", String(e?.message ?? e));
      return false;
    }
  }

  const webappDir = findWebappDir();
  if (!packaged && !webappDir) return false;
  if (!packaged) try {
    console.log("⏳ 개발 서버 기동 중…", webappDir);
    showSplash("개발 서버를 기동하고 있습니다…");
    // Windows: Node 20+(CVE-2024-27980)는 .cmd/.bat을 shell:false로 spawn하면 EINVAL로 죽는다.
    // 반드시 shell:true 로 실행해야 npm.cmd가 뜬다. 실패해도 설정 화면으로 안전하게 폴백.
    serverChild = spawn("npm.cmd", ["run", "dev"], {
      cwd: webappDir,
      windowsHide: true,
      stdio: "ignore",
      shell: true,
    });
    serverChild.on("error", (e) => console.warn("⚠️ 로컬 서버 기동 실패:", String(e?.message ?? e)));
  } catch (e) {
    console.warn("⚠️ 로컬 서버 spawn 예외:", String(e?.message ?? e));
    return false;
  }
  const t0 = Date.now();
  let lastSplashUpdate = t0;
  while (Date.now() - t0 < 90_000) {
    await new Promise((r) => setTimeout(r, 1200));
    if (Date.now() - lastSplashUpdate >= 7_000) {
      const elapsed = Math.max(1, Math.round((Date.now() - t0) / 1000));
      showSplash(`Vision Engine Studio를 준비하고 있습니다… (${elapsed}초)`);
      lastSplashUpdate = Date.now();
    }
    // 우리가 띄운 서버도 tailnet 모드면 127.0.0.1에 안 붙는다 — 후보 전체를 본다
    const found = await findRunningServer();
    if (found) {
      spawnedTarget = found;
      runtimeRestartAttempts = 0;
      return true;
    }
  }
  return false;
}

/** 접속 대상 결정: 설정된 원격 서버 → 로컬 서버 재사용 → 로컬 기동 → 실패(null) */
async function resolveTarget() {
  const cfg = loadConfig();
  if (cfg.serverUrl) {
    if (await ping(cfg.serverUrl)) return cfg.serverUrl.replace(/\/+$/, "");
    // 원격이 설정돼 있는데 죽어 있으면 — 로컬 폴백을 시도하되, 안 되면 설정 화면에서 안내
    if (await ping(LOCAL_URL)) return LOCAL_URL;
    return null;
  }
  const running = await findRunningServer();
  if (running) return running;
  if (await trySpawnLocalServer()) return spawnedTarget ?? LOCAL_URL;
  return null;
}

function openSettings(message = "") {
  if (!win) return;
  void win.loadFile(path.join(__dirname, "settings.html"), { query: message ? { msg: message } : undefined })
    .then(() => revealMainWindow())
    .catch((error) => console.error("❌ 설정 화면 로드 실패:", String(error?.message || error)));
}

/**
 * 준비 중 화면 — 메인 BrowserWindow와 분리해서 보여준다.
 * 서버/AI 준비 중 메인 창이 데이터 URL과 앱 URL 사이를 오가며 깜빡이던 문제도 함께 막는다.
 */
function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showSplash(note = "로컬 서버를 찾고 있습니다…") {
  if (!splashWin || splashWin.isDestroyed()) {
    splashWin = new BrowserWindow({
      width: 520,
      height: 330,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      center: true,
      backgroundColor: "#10131a",
      title: "Vision Engine 준비 중",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: false,
      },
    });
    splashWin.on("closed", () => { splashWin = null; });
  }
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0}
    body{background:radial-gradient(circle at 50% 0,#252044 0,#141824 46%,#10131a 100%);color:#cbd3e4;
      display:flex;align-items:center;justify-content:center;font-family:"Malgun Gothic","Segoe UI",system-ui,sans-serif;
      -webkit-user-select:none;border:1px solid #343b51;box-sizing:border-box}
    .box{width:390px;text-align:center;line-height:1.65}
    .logo{width:62px;height:62px;margin:0 auto 14px;border-radius:18px;display:grid;place-items:center;
      font-size:31px;background:linear-gradient(145deg,#7968ef,#4c3e9e);box-shadow:0 10px 30px #5d4bd055}
    .t{font-size:19px;font-weight:800;color:#f2f4fa;letter-spacing:-.2px}
    .s{font-size:13px;color:#aab4c9;margin-top:8px;min-height:22px}
    .steps{display:flex;justify-content:center;gap:18px;margin-top:19px;font-size:11px;color:#707b91}
    .steps span:first-child{color:#b9abff}.steps i{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:5px}
    .bar{width:280px;height:4px;border-radius:4px;background:#252b3b;overflow:hidden;margin:19px auto 0}
    .bar i{display:block;width:36%;height:100%;border-radius:4px;background:linear-gradient(90deg,#7e6df1,#a999ff);animation:slide 1.15s ease-in-out infinite}
    .hint{font-size:11px;color:#69748a;margin-top:12px}
    @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(360%)}}
  </style></head><body><div class="box">
    <div class="logo">🏢</div><div class="t">Vision Engine을 준비하고 있습니다</div>
    <div class="s">${escapeHtml(note)}</div>
    <div class="steps"><span><i></i>앱 엔진</span><span><i></i>프로젝트</span><span><i></i>AI 연결</span></div>
    <div class="bar"><i></i></div>
    <div class="hint">AI가 늦어져도 Studio는 먼저 열립니다</div>
  </div></body></html>`;
  void splashWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).then(() => {
    if (!splashWin || splashWin.isDestroyed()) return;
    splashWin.show();
    splashWin.focus();
  }).catch((error) => console.warn("⚠️ 로딩 창 표시 실패:", String(error?.message || error)));
}

function revealMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
  splashWin = null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function connect() {
  const target = await resolveTarget();
  if (!target) {
    const cfg = loadConfig();
    openSettings(
      cfg.serverUrl
        ? `설정된 서버(${cfg.serverUrl})에 연결할 수 없습니다 — 서버 PC에서 VisionEngine-Start.bat이 켜져 있는지, Tailscale이 연결됐는지 확인하세요.`
        : "서버를 찾지 못했습니다 — 서버 PC의 주소를 입력하세요."
    );
    return;
  }
  currentTarget = target;
  console.log("✅ 접속:", target);
  // 일시 오류(캐시 손상·서버 재시작 직후 등)로 빈 창이 뜨지 않게 — 재시도 후 실패 시 설정 화면 안내
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await win.loadURL(target);
      revealMainWindow();
      return;
    } catch (e) {
      console.warn(`⚠️ 로드 실패 (${attempt}/3):`, String(e?.message ?? e).slice(0, 80));
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  openSettings(`서버(${target})는 살아있지만 화면을 불러오지 못했습니다 — 잠시 후 저장을 다시 누르거나 앱을 재시작해 보세요.`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#12151c",
    title: "Vision Engine — 게임 개발 스튜디오",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      safeDialogs: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false },
        },
      };
    }
    openSafeExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openSafeExternal(url);
  });
  win.webContents.on("did-finish-load", () => console.log("✅ 창 로드 완료"));
  // 닫기 = 트레이로 숨김 (매일 켜두는 도구) — 실제 종료는 트레이 메뉴에서
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // 창이 실제로 파괴되면 참조를 반드시 버린다.
  // 이게 없어서 showWindow가 죽은 창을 붙들고 예외를 던졌고, 바로가기가 먹통이 됐다(2026-08-06).
  win.on("closed", () => {
    win = null;
  });
  return win;
}

/**
 * 창을 앞으로 — 바로가기 재실행(second-instance)·트레이 "열기"·activate가 전부 여기로 온다.
 *
 * 오너 신고 2026-08-06 "바로가기가 안 켜진다"의 원인:
 * 이 앱은 창을 닫아도 종료하지 않고 트레이에 숨는다(close에서 preventDefault + hide).
 * 그런데 `win`은 창이 **파괴돼도 null이 되지 않았다** — "closed" 핸들러가 없었기 때문이다.
 * 그래서 파괴된 창이 남아 있으면 아래 `win.isMinimized()`가
 * `TypeError: Object has been destroyed`로 던지고, 그 예외가 second-instance 핸들러 안에서
 * 발생하므로 **바로가기를 눌러도 화면에 아무 일도 일어나지 않는다**(트레이 "열기"도 같이 먹통).
 * 프로세스는 살아 있어서 사용자에겐 "실행이 안 된다"로만 보인다.
 *
 * 그래서 ⓐ 파괴 여부를 먼저 확인하고 ⓑ 그래도 던지면 창을 새로 만든다.
 * 이 함수는 앱의 유일한 복귀 경로라 **어떤 경우에도 조용히 실패하면 안 된다.**
 */
function showWindow() {
  const revive = () => {
    win = null;
    createWindow();
    showSplash();
    void connect();
  };
  if (!win || win.isDestroyed()) {
    revive();
    return;
  }
  try {
    if (splashWin && !splashWin.isDestroyed() && !win.isVisible()) {
      splashWin.show();
      splashWin.focus();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch (e) {
    console.warn("⚠️ 기존 창 복귀 실패 — 새 창을 만듭니다:", String(e?.message ?? e));
    revive();
  }
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const product = loadProductConfig();
  const updateLabel = updateState.status === "downloading"
    ? `업데이트 다운로드 중… ${updateState.progress}%`
    : updateState.status === "backing-up"
      ? "업데이트 전 프로젝트 백업 중…"
      : updateState.status === "backup-error"
        ? "업데이트 백업 다시 시도…"
        : updateState.status === "scheduled"
          ? `업데이트 ${updateState.version || ""} · 종료 시 설치`
    : updateState.status === "ready"
      ? `업데이트 ${updateState.version || ""} 설치 준비됨`
      : "업데이트 확인…";
  const supportItems = [];
  if (/^https:\/\//i.test(String(product.privacyUrl || ""))) supportItems.push({ label: "개인정보 처리방침", click: () => openSafeExternal(product.privacyUrl) });
  if (/^https:\/\//i.test(String(product.termsUrl || ""))) supportItems.push({ label: "소프트웨어 이용약관", click: () => openSafeExternal(product.termsUrl) });
  if (/^https:\/\//i.test(String(product.supportPolicyUrl || ""))) supportItems.push({ label: "고객 지원 안내", click: () => openSafeExternal(product.supportPolicyUrl) });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(product.supportEmail || ""))) supportItems.push({ label: "고객 지원 문의…", click: () => openSafeExternal(`mailto:${product.supportEmail}`) });
  const menu = Menu.buildFromTemplate([
    { label: "🏢 Vision Engine 열기", click: showWindow },
    { type: "separator" },
    { label: `버전 ${app.getVersion()}`, enabled: false },
    { label: updateLabel, enabled: !["disabled", "downloading", "backing-up", "scheduled"].includes(updateState.status), click: () => { void checkForUpdates(true); } },
    { label: "진단 보고서 저장…", click: () => { void exportSupportReport(); } },
    { label: "진단 로그 폴더 열기", click: openDiagnosticFolder },
    { label: "업데이트 백업 폴더 열기", click: () => {
      const directory = path.join(app.getPath("userData"), "backups");
      fs.mkdirSync(directory, { recursive: true });
      void shell.openPath(directory);
    } },
    { label: "사용자 데이터 폴더 열기", click: () => { void shell.openPath(desktopDataRoot()); } },
    ...(supportItems.length ? [{ type: "separator" }, ...supportItems] : []),
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function setupTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray-icon.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Vision Engine — 게임 개발 스튜디오");
  refreshTrayMenu();
  tray.on("double-click", showWindow);
}

function trustedIpcSender(event, allowSettings = false) {
  const raw = String(event?.senderFrame?.url || event?.sender?.getURL?.() || "");
  try {
    const parsed = new URL(raw);
    if (allowSettings && parsed.protocol === "file:") {
      return path.resolve(fileURLToPath(parsed)) === path.resolve(__dirname, "settings.html");
    }
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1")
      && sameOrigin(raw);
  } catch { return false; }
}

function handleTrusted(channel, handler, { allowSettings = false } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedIpcSender(event, allowSettings)) throw new Error("허용되지 않은 화면에서 데스크톱 기능을 요청했습니다.");
    return handler(event, ...args);
  });
}

/* 설정 화면 및 로컬 Studio 전용 IPC */
handleTrusted("ve:getConfig", () => loadConfig(), { allowSettings: true });
handleTrusted("ve:test", async (_event, url) => await ping(url), { allowSettings: true });
handleTrusted("ve:save", async (_event, url) => {
  const cfg = loadConfig();
  cfg.serverUrl = String(url ?? "").trim().replace(/\/+$/, "");
  if (!cfg.serverUrl) delete cfg.serverUrl;
  saveConfig(cfg);
  await connect();
  return true;
}, { allowSettings: true });
handleTrusted("ve:chooseDirectory", async (_event, title) => {
  const result = await dialog.showOpenDialog(win, {
    title: String(title || "폴더 선택"),
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? "" : (result.filePaths[0] || "");
});
handleTrusted("ve:codexLogin", async () => {
  const cli = findCodexNativeExecutable();
  if (!cli) return { ok: false, error: "설치본에서 이 PC용 Codex 실행 파일을 찾지 못했습니다." };
  try {
    if (process.platform === "win32") {
      const child = spawn("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NoExit", "-Command",
        "& $env:VE_CODEX_CLI login; Write-Host ''; Write-Host '로그인 확인 후 이 창을 닫으세요.'",
      ], { windowsHide: false, detached: true, stdio: "ignore", env: { ...process.env, VE_CODEX_CLI: cli } });
      child.unref();
    } else {
      const child = spawn(cli, ["login"], { detached: true, stdio: "ignore" });
      child.unref();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
});
handleTrusted("ve:claudeLogin", async () => {
  const cli = findClaudeExecutable();
  if (!cli) {
    await shell.openExternal("https://docs.anthropic.com/en/docs/claude-code/getting-started");
    return { ok: false, openedDocs: true, error: "Claude Code CLI가 없어 공식 설치 안내를 열었습니다." };
  }
  try {
    const env = externalAiEnv({ VE_CLAUDE_CLI: cli });
    for (const key of Object.keys(env)) {
      if (/^ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL)$/i.test(key)
        || /^CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)$/i.test(key)
        || /^(?:AWS_|AMAZON_BEDROCK_|VERTEX_)/i.test(key)) delete env[key];
    }
    if (process.platform === "win32") {
      const child = spawn("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NoExit", "-Command",
        "& $env:VE_CLAUDE_CLI auth login --claudeai; Write-Host ''; Write-Host 'Claude 구독 로그인 확인 후 이 창을 닫으세요.'",
      ], { windowsHide: false, detached: true, stdio: "ignore", env });
      child.unref();
    } else {
      const child = spawn(cli, ["auth", "login", "--claudeai"], { detached: true, stdio: "ignore", env });
      child.unref();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
});
handleTrusted("ve:startOpenClaw", async () => {
  return tryStartOpenClawGateway();
});
handleTrusted("ve:openclawOnboard", async () => launchOpenClawOnboard());
handleTrusted("ve:openclawSecrets", async () => launchOpenClawSecrets());
handleTrusted("ve:protectOpenClawSecrets", async () => protectOpenClawSecrets());
handleTrusted("ve:auditOpenClawSecrets", async () => auditOpenClawSecretProtection());
handleTrusted("ve:ollamaPull", async (_event, model) => launchOllamaPull(String(model || "qwen3.5:4b")));
handleTrusted("ve:exportSupportReport", async () => exportSupportReport());
handleTrusted("ve:getUpdateState", async () => publicUpdateState());
handleTrusted("ve:checkForUpdates", async () => checkForUpdates(true));

// 로컬 개발 서버 콘텐츠 — HTTP 캐시가 손상되면 ERR_FAILED로 빈 창이 뜨므로 캐시를 끈다
app.enableSandbox();
app.commandLine.appendSwitch("disable-http-cache");

// 단일 인스턴스 — 창을 닫으면 트레이로 숨으므로(종료 아님), 바로가기를 다시 누르면
// 두 번째 인스턴스가 뜬다. 이때 아래 whenReady까지 실행되면 두 인스턴스가 같은
// userData의 Chromium 캐시를 다투다 "Unable to move the cache: 액세스 거부"로
// 페이지 로드가 ERR_FAILED가 되고 빈/깨진 창이 뜬다(오너 신고 2026-07-19, 결정적 재현).
// 반드시 락을 쥔 인스턴스만 창을 만들고, 못 쥔 쪽은 whenReady 자체를 등록하지 않는다.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // 창·연결을 만들지 않고 즉시 물러난다. 기존 인스턴스가 second-instance로 창을 띄운다.
} else {
  // 두 번째 실행 = 기존 창을 앞으로. 트레이에 숨어 있던 창이 이걸로 다시 뜬다.
  // 바로가기를 다시 누르면 여기로 온다. 여기서 던지면 사용자에겐 "실행이 안 된다"로만 보이므로,
  // 어떤 예외가 나도 마지막에 창 하나는 반드시 띄운다(2026-08-06 오너 신고 대응).
  app.on("second-instance", () => {
    try {
      showWindow();
    } catch (e) {
      console.warn("⚠️ second-instance 처리 실패 — 창을 새로 만듭니다:", String(e?.message ?? e));
      try {
        win = null;
        createWindow();
        showSplash();
        void connect();
      } catch (e2) {
        console.error("❌ 창 생성 실패:", String(e2?.message ?? e2));
      }
    }
  });

  // 트레이 상주 — 모든 창이 닫혀도 앱은 살아있는다 (기본 동작은 종료라서 명시)
  app.on("window-all-closed", () => {
    /* noop — 트레이 메뉴의 "종료"로만 끝낸다 */
  });

  app.whenReady().then(async () => {
    initDiagnostics();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    setupTray();
    configureAutoUpdater();
    createWindow();
    showSplash(); // 서버 탐색·기동 동안 빈 창(검은 화면)이 보이지 않게 즉시 표시
    await connect();
    if (updateState.status !== "disabled") setTimeout(() => { void checkForUpdates(false); }, 15_000);
    // 글로벌 단축키 — 어디서든 Ctrl+Shift+V 로 창을 띄운다
    globalShortcut.register("CommandOrControl+Shift+V", showWindow);
    app.on("activate", showWindow);
  });
}

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", () => {
  quitting = true;
  if (runtimeRestartTimer) clearTimeout(runtimeRestartTimer);
  runtimeRestartTimer = null;
  if (gatewayRestartTimer) clearTimeout(gatewayRestartTimer);
  gatewayRestartTimer = null;
});
// 트레이 상주 — 모든 창을 닫아도 종료하지 않는다 (트레이 메뉴 종료로만)
app.on("quit", () => {
  if (gatewayChild?.pid) {
    try {
      spawn("taskkill", ["/PID", String(gatewayChild.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* noop */
    }
  }
  if (serverChild?.pid) {
    try {
      spawn("taskkill", ["/PID", String(serverChild.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* noop */
    }
  }
});
