// 데스크톱 알림 — 회의·개발 작업이 끝나면 알린다 (앱을 켜두고 다른 일을 하게 만드는 장치).
// Electron(Chromium)·브라우저 모두 Notification API 사용. localStorage로 on/off.

const KEY = "ve-notify";

export function notifyEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
export function setNotifyEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* noop */
  }
  if (on) void ensurePermission();
}

async function ensurePermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

let lastFired = 0;
/** 완료 알림 — 창이 이미 포커스면 굳이 띄우지 않는다 (스팸 방지) */
export async function notify(title: string, body: string): Promise<void> {
  if (!notifyEnabled() || typeof Notification === "undefined") return;
  if (typeof document !== "undefined" && document.hasFocus()) return;
  const now = Date.now();
  if (now - lastFired < 1500) return; // 연쇄 완료 시 과다 알림 방지
  lastFired = now;
  if (!(await ensurePermission())) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 160), tag: "vision-engine" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* noop */
  }
}
