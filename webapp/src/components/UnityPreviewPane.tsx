import { useCallback, useEffect, useRef, useState } from "react";
import { saveUnityDir } from "../lib/mcp";
import { getUnityPreviewStatus, saveUnityWebglDir, useUnityAsCodexWorkdir, type UnityPreviewStatus } from "../lib/unity";

function buildTime(value: number): string {
  if (!value) return "빌드 없음";
  return new Date(value).toLocaleString("ko-KR", { hour12: false });
}

export function UnityPreviewPane({ running }: { running: boolean }) {
  const [status, setStatus] = useState<UnityPreviewStatus | null>(null);
  const [projectDir, setProjectDir] = useState("");
  const [webglDir, setWebglDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoReload, setAutoReload] = useState(true);
  const [frameVersion, setFrameVersion] = useState(0);
  const lastBuild = useRef(0);
  const initialized = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await getUnityPreviewStatus();
      setStatus(next);
      if (!initialized.current) {
        initialized.current = true;
        setProjectDir(next.projectDir ?? "");
        setWebglDir(next.configuredBuild ?? next.buildDir ?? "");
      }
      if (autoReload && lastBuild.current > 0 && next.updatedAt > lastBuild.current) {
        setFrameVersion((value) => value + 1);
      }
      lastBuild.current = next.updatedAt;
      if (!quiet) setError("");
    } catch (reason: any) {
      if (!quiet) setError(String(reason?.message || reason));
    }
  }, [autoReload]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), running ? 2_000 : 4_000);
    return () => window.clearInterval(timer);
  }, [refresh, running]);

  const connectProject = async () => {
    if (!projectDir.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveUnityDir(projectDir.trim());
      if (!result.exists) throw new Error("입력한 Unity 프로젝트 폴더를 찾을 수 없습니다.");
      await useUnityAsCodexWorkdir(result.dir);
      initialized.current = false;
      await refresh();
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setBusy(false);
    }
  };

  const connectBuild = async () => {
    if (!webglDir.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await saveUnityWebglDir(webglDir.trim());
      setStatus(next);
      lastBuild.current = next.updatedAt;
      setFrameVersion((value) => value + 1);
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = status?.previewUrl
    ? `${status.previewUrl}${status.previewUrl.includes("?") ? "&" : "?"}frame=${frameVersion}`
    : "";

  return (
    <section className="unity-preview-pane" aria-label="Unity WebGL 미리보기">
      <header className="unity-preview-head">
        <div>
          <b>🎮 실시간 WebGL 미리보기</b>
          <span className="dim">Unity 빌드가 바뀌면 이 화면을 자동으로 새로고칩니다.</span>
        </div>
        <div className="unity-preview-actions">
          <label title="WebGL 빌드 파일 변경을 감지해 자동으로 새로고칩니다.">
            <input type="checkbox" checked={autoReload} onChange={(event) => setAutoReload(event.target.checked)} /> 자동 갱신
          </label>
          <button className="btn small" onClick={() => { setFrameVersion((value) => value + 1); void refresh(); }}>
            ↻ 새로고침
          </button>
        </div>
      </header>

      <div className={`unity-preview-status ${status?.ready ? "ok" : "warn"}`}>
        <span>{status?.ready ? "● 미리보기 준비" : "● 연결 필요"}</span>
        <span className="dim">{status?.reason ?? "상태 확인 중…"}</span>
        {status?.ready && <span className="dim">최근 빌드 {buildTime(status.updatedAt)}</span>}
      </div>

      {status?.ready && previewSrc ? (
        <div className="unity-frame-wrap">
          <iframe
            key={`${status.updatedAt}-${frameVersion}`}
            src={previewSrc}
            title="Unity WebGL 게임 미리보기"
            allow="autoplay; fullscreen; gamepad"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-downloads allow-forms"
          />
          {running && <div className="unity-working-badge"><span className="spinner" /> 선임 개발자 작업 중 · 기존 빌드를 표시합니다</div>}
        </div>
      ) : (
        <div className="unity-preview-empty">
          <div className="unity-preview-hero">🧊</div>
          <b>Unity 게임 화면을 이곳에 띄울 수 있습니다.</b>
          <p>
            Unity에서 <code>File → Build Profiles → WebGL → Build</code>를 실행하고<br />
            출력 폴더를 <code>Builds/WebGL</code>로 지정하면 자동 감지됩니다.
          </p>
        </div>
      )}

      <details className="unity-paths" open={!status?.ready}>
        <summary>연결 경로 설정</summary>
        <label>
          <span>Unity·Codex 프로젝트</span>
          <div>
            <input value={projectDir} onChange={(event) => setProjectDir(event.target.value)} placeholder="D:\\MyGame" />
            <button className="btn small" onClick={() => void connectProject()} disabled={busy || !projectDir.trim()}>연결</button>
          </div>
        </label>
        <label>
          <span>WebGL 빌드 폴더</span>
          <div>
            <input value={webglDir} onChange={(event) => setWebglDir(event.target.value)} placeholder="D:\\MyGame\\Builds\\WebGL" />
            <button className="btn small" onClick={() => void connectBuild()} disabled={busy || !webglDir.trim()}>적용</button>
          </div>
        </label>
        <small className="dim">소스 수정은 즉시 반영되지 않습니다. Unity가 WebGL을 다시 빌드하면 자동 갱신됩니다.</small>
      </details>
      {error && <div className="unity-preview-error">⚠️ {error}</div>}
    </section>
  );
}
