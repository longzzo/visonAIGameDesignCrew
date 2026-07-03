// 앱 공용 다이얼로그 — window.prompt/confirm/alert 대체.
// DialogHost가 마운트되어 있으면 스타일된 모달로, 아니면 브라우저 기본으로 폴백.
// 동시에 여러 요청이 오면 큐로 순차 표시한다.

export interface DialogRequest {
  kind: "prompt" | "confirm" | "alert";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 파괴적 작업(삭제 등) — 확인 버튼을 빨간색으로 */
  danger?: boolean;
  /** prompt는 string|null, confirm은 boolean, alert는 undefined */
  resolve: (value: any) => void;
}

let host: ((r: DialogRequest | null) => void) | null = null;
let active: DialogRequest | null = null;
const queue: DialogRequest[] = [];

function pump() {
  if (!host || active) return;
  active = queue.shift() ?? null;
  host(active);
}

/** DialogHost 전용 — 마운트 시 바인딩 */
export function bindDialogHost(fn: (r: DialogRequest | null) => void): () => void {
  host = fn;
  pump();
  return () => {
    host = null;
  };
}

/** DialogHost 전용 — 현재 다이얼로그를 닫고 다음 것을 표시 */
export function closeActiveDialog(value: any) {
  const cur = active;
  active = null;
  cur?.resolve(value);
  pump();
}

function enqueue(req: DialogRequest) {
  queue.push(req);
  pump();
}

interface PromptOpts {
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export function uiPrompt(title: string, opts: PromptOpts = {}): Promise<string | null> {
  if (!host) return Promise.resolve(window.prompt(`${title}${opts.message ? `\n${opts.message}` : ""}`, opts.defaultValue ?? ""));
  return new Promise((resolve) => enqueue({ kind: "prompt", title, ...opts, resolve }));
}

interface ConfirmOpts {
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function uiConfirm(title: string, opts: ConfirmOpts = {}): Promise<boolean> {
  if (!host) return Promise.resolve(window.confirm(`${title}${opts.message ? `\n${opts.message}` : ""}`));
  return new Promise((resolve) => enqueue({ kind: "confirm", title, ...opts, resolve }));
}

export function uiAlert(title: string, message?: string): Promise<void> {
  if (!host) {
    window.alert(`${title}${message ? `\n${message}` : ""}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => enqueue({ kind: "alert", title, message, resolve }));
}
