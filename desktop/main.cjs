// Vision Engine 데스크톱 셸 (v2.0c)
// 두 가지 모드:
//   · 서버 PC(이 노트북): 로컬 서버를 재사용/자동 기동해서 로드
//   · 클라이언트 PC(다른 컴퓨터): 설정된 서버 주소(예: 노트북의 Tailscale 주소)로 접속
// 서버 주소는 첫 실행 설정 화면 또는 연결 실패 시 설정 화면에서 저장한다.
const { app, BrowserWindow, shell, Menu, ipcMain, Tray, globalShortcut, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const https = require("node:https");

let tray = null;
let quitting = false;

const LOCAL_URL = "http://127.0.0.1:5199";

/**
 * webapp 폴더 탐색 — 설치된 앱은 __dirname이 resources/app이라 ../webapp이 없다.
 * 후보: 설정(repoDir) → 환경변수 → 개발 체크아웃(../webapp) → 알려진 설치 경로.
 */
function findWebappDir() {
  const cfg = loadConfig();
  const candidates = [
    cfg.repoDir && path.join(cfg.repoDir, "webapp"),
    process.env.VE_REPO && path.join(process.env.VE_REPO, "webapp"),
    path.resolve(__dirname, "..", "webapp"),
    "D:\\Claude\\vision-engine\\vision-engine\\webapp",
    path.join(os.homedir(), "vision-engine", "webapp"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    } catch {
      /* noop */
    }
  }
  return null;
}

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
  const webappDir = findWebappDir();
  if (!webappDir) return false;
  console.log("⏳ 로컬 서버 기동 중…", webappDir);
  showSplash("로컬 서버를 기동하고 있습니다…");
  try {
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

/**
 * 준비 중 화면 — 서버를 찾고/기동하는 동안(최초 실행은 1분 가까이 걸린다) 창이 새까맣게
 * 비어 있으면 "앱이 검은 화면만 뜬다"로 보인다. 곧바로 이 화면을 띄워 진행 상태를 알린다.
 */
function showSplash(note = "로컬 서버를 찾고 있습니다…") {
  if (!win) return;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0}
    body{background:#12151c;color:#c3cbdb;display:flex;align-items:center;justify-content:center;
      font-family:"Malgun Gothic","Segoe UI",system-ui,sans-serif;-webkit-user-select:none}
    .box{text-align:center;line-height:1.7}
    .logo{font-size:34px;margin-bottom:10px}
    .t{font-size:16px;font-weight:700;color:#e8edf5}
    .s{font-size:12.5px;color:#8b94a7;margin-top:6px}
    .bar{width:210px;height:3px;border-radius:2px;background:#232838;overflow:hidden;margin:16px auto 0}
    .bar i{display:block;width:38%;height:100%;border-radius:2px;background:#8b7cf6;animation:slide 1.1s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(360%)}}
  </style></head><body><div class="box">
    <div class="logo">🏢</div><div class="t">Vision Engine 준비 중…</div>
    <div class="s">${note}</div>
    <div class="s">최초 실행은 1분 정도 걸릴 수 있습니다</div>
    <div class="bar"><i></i></div>
  </div></body></html>`;
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
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
    showSplash();
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

// 로컬 개발 서버 콘텐츠 — HTTP 캐시가 손상되면 ERR_FAILED로 빈 창이 뜨므로 캐시를 끈다
app.commandLine.appendSwitch("disable-http-cache");

// 단일 인스턴스 — 두 번째 실행 시 기존 창을 띄운다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
}

// 트레이 상주 — 모든 창이 닫혀도 앱은 살아있는다 (기본 동작은 종료라서 명시)
app.on("window-all-closed", () => {
  /* noop — 트레이 메뉴의 "종료"로만 끝낸다 */
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  setupTray();
  createWindow();
  showSplash(); // 서버 탐색·기동 동안 빈 창(검은 화면)이 보이지 않게 즉시 표시
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
