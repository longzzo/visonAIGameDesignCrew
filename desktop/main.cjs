// Vision Engine 데스크톱 셸 (v2.0b — 스트랭글러 1단계)
// 서버(웹앱 dev 서버)가 없으면 직접 띄우고, 준비되면 네이티브 창에 로드한다.
// 기존 기능 100% 승계가 목표 — 서버 코드는 아직 웹앱과 동일본을 쓴다 (v2.1에서 모듈 추출).
const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}`;
const WEBAPP_DIR = path.resolve(__dirname, "..", "webapp");

let serverChild = null; // 우리가 띄운 경우에만 종료 시 정리

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await ping()) {
    console.log("✅ 기존 서버 재사용:", URL);
    return;
  }
  console.log("⏳ 서버 기동 중… (webapp dev 서버)");
  serverChild = spawn("npm.cmd", ["run", "dev"], {
    cwd: WEBAPP_DIR,
    windowsHide: true,
    stdio: "ignore",
    shell: false,
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    await new Promise((r) => setTimeout(r, 1200));
    if (await ping()) {
      console.log("✅ 서버 준비 완료");
      return;
    }
  }
  throw new Error("서버가 90초 안에 뜨지 않았습니다 — webapp에서 npm install이 됐는지 확인하세요.");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#12151c",
    title: "Vision Engine — 게임 개발 스튜디오",
    autoHideMenuBar: true,
  });
  // 외부 링크는 기본 브라우저로 (앱 창을 뺏기지 않게)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL)) return { action: "allow" }; // 프로토타입 새 탭 등 내부 링크
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(URL);
  win.webContents.on("did-finish-load", () => console.log("✅ 창 로드 완료"));
  return win;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await ensureServer();
  } catch (e) {
    console.error(String(e));
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
app.on("quit", () => {
  // 우리가 띄운 서버만 정리 (오너가 따로 띄운 서버는 건드리지 않음)
  if (serverChild && !serverChild.killed) {
    try {
      spawn("taskkill", ["/PID", String(serverChild.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* noop */
    }
  }
});
