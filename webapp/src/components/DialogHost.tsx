import { useEffect, useRef, useState } from "react";
import { bindDialogHost, closeActiveDialog, type DialogRequest } from "../lib/dialog";

/** 앱 공용 다이얼로그 렌더러 — App 최상단에 한 번만 마운트 */
export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      bindDialogHost((r) => {
        setReq(r);
        setValue(r?.defaultValue ?? "");
      }),
    []
  );

  useEffect(() => {
    if (req?.kind === "prompt") setTimeout(() => inputRef.current?.select(), 30);
  }, [req]);

  if (!req) return null;

  const cancel = () => closeActiveDialog(req.kind === "prompt" ? null : req.kind === "confirm" ? false : undefined);
  const confirm = () => closeActiveDialog(req.kind === "prompt" ? value : req.kind === "confirm" ? true : undefined);

  return (
    <div
      className="dialog-veil"
      onClick={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <div className="dialog-box" role="dialog" aria-modal="true">
        <div className="dialog-title">{req.title}</div>
        {req.message && <div className="dialog-message dim">{req.message}</div>}
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            className="dialog-input"
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) confirm();
            }}
          />
        )}
        <div className="dialog-actions">
          {req.kind !== "alert" && (
            <button className="btn" onClick={cancel} autoFocus={req.kind === "confirm" && req.danger}>
              {req.cancelLabel ?? "취소"}
            </button>
          )}
          <button
            className={`btn ${req.danger ? "danger" : "primary"}`}
            onClick={confirm}
            autoFocus={req.kind === "alert" || (req.kind === "confirm" && !req.danger)}
          >
            {req.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
