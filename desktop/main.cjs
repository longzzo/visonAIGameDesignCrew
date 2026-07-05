// Vision Engine 데스크톱 셸 (v2.0c)
// 두 가지 모드:
//   · 서버 PC(이 노트북): 로컬 서버를 재사용/자동 기동해서 로드
//   · 클라이언트 PC(다른 컴퓨터): 설정된 서버 주소(예: 노트북의 Tailscale 주소)로 접속
// 서버 주소는 첫 실행 설정 화면 또는 연결 실패 시 설정 화면에서 저장한다.
const { app, BrowserWindow, shell, Menu, ipcMain, Tray, globalShortcut, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

let tray = null;
let quitting = false;

const LOCAL_URL = "http://127.0.0.1:5199";
const WEBAPP_DIR = path.resolve(__dirname, "..", "webapp");

let serverChild = null; // 우리가 띄운 경우에만 종료 시 정리
let win = null;
let currentTarget = LOCAL_URL;

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

/** 로컬 서버가 없고 이 PC에 저장소(webapp)가 있으면 직접 띄운다 */
async function trySpawnLocalServer() {
  if (!fs.existsSync(path.join(WEBAPP_DIR, "package.json"))) return false;
  console.log("⏳ 로컬 서버 기동 중…");
  serverChild = spawn("npm.cmd", ["run", "dev"], {
    cwd: WEBAPP_DIR,
    windowsHide: true,
    stdio: "ignore",
    shell: false,
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    await new Promise((r) => setTimeout(r, 1200));
    if (await ping(LOCAL_URL)) return true;
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
  if (await ping(LOCAL_URL)) return LOCAL_URL;
  if (await trySpawnLocalServer()) return LOCAL_URL;
  return null;
}

function openSettings(message = "") {
  if (!win) return;
  void win.loadFile(path.join(__dirname, "settings.html"), { query: message ? { msg: message } : undefined });
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
  await win.loadURL(target);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#12151c",
    title: "Vision Engine — 게임 개발 스튜디오",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(currentTarget)) return { action: "allow" }; // 프로토타입 새 탭 등 내부 링크
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-finish-load", () => console.log("✅ 창 로드 완료"));
  // 닫기 = 트레이로 숨김 (매일 켜두는 도구) — 실제 종료는 트레이 메뉴에서
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  return win;
}

function showWindow() {
  if (!win) {
    createWindow();
    void connect();
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function setupTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray-icon.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Vision Engine — 게임 개발 스튜디오");
  const menu = Menu.buildFromTemplate([
    { label: "🏢 Vision Engine 열기", click: showWindow },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", showWindow);
}

/* 설정 화면 IPC */
ipcMain.handle("ve:getConfig", () => loadConfig());
ipcMain.handle("ve:test", async (_e, url) => await ping(url));
ipcMain.handle("ve:save", async (_e, url) => {
  const cfg = loadConfig();
  cfg.serverUrl = String(url ?? "").trim().replace(/\/+$/, "");
  if (!cfg.serverUrl) delete cfg.serverUrl;
  saveConfig(cfg);
  await connect();
  return true;
});

// 단일 인스턴스 — 두 번째 실행 시 기존 창을 띄운다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  setupTray();
  createWindow();
  await connect();
  // 글로벌 단축키 — 어디서든 Ctrl+Shift+V 로 창을 띄운다
  globalShortcut.register("CommandOrControl+Shift+V", showWindow);
  app.on("activate", showWindow);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", () => { quitting = true; });
// 트레이 상주 — 모든 창을 닫아도 종료하지 않는다 (트레이 메뉴 종료로만)
app.on("quit", () => {
  if (serverChild && !serverChild.killed) {
    try {
      spawn("taskkill", ["/PID", String(serverChild.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* noop */
    }
  }
});
