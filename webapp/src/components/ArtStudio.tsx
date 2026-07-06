import { useEffect, useState } from "react";
import { artFileUrl } from "../lib/art";
import { uiConfirm } from "../lib/dialog";
import { useVE } from "../store";

/**
 * 아트 스튜디오 — 아트 인턴(로컬 Stable Diffusion) 작업실.
 * 오너 요청 → 아트 디렉터가 확정 아트 방향에 맞는 SD 프롬프트 작성 → 인턴이 생성.
 */
export function ArtStudio({ onClose }: { onClose: () => void }) {
  const {
    activeProject,
    artStatus,
    checkArtStatus,
    artImages,
    artBusy,
    artPhase,
    generateArt,
    removeArt,
    attachArtToGdd,
    artProvider,
    setArtProvider,
  } = useVE();
  const [attached, setAttached] = useState<number[]>([]);
  const [request, setRequest] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    void checkArtStatus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = artStatus?.connected === true;
  const nvidiaOk = artStatus?.nvidia === true;
  // 로컬 미연결이어도 NVIDIA가 있으면(자동/NVIDIA) 생성 가능. 로컬 전용 선택 시엔 로컬 필요.
  const canGenerate =
    artProvider === "local" ? connected : connected || nvidiaOk;

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window art-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">🖌️ 아트 스튜디오 — 아트 인턴</div>
            <div className="head-role dim">
              🖥️ 로컬 SD {connected ? "연결됨 ✓" : "미연결"} · ☁️ NVIDIA {nvidiaOk ? "사용 가능 ✓" : "키 없음"}
              {connected ? ` (${artStatus?.url})` : ""}
            </div>
          </div>
          <button className="btn small" onClick={() => void checkArtStatus()}>
            🔄 연결 확인
          </button>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        {/* 제공자 라우팅 선택 — 규제 소지 있는 아트는 로컬이 안전 */}
        <div className="art-provider-bar">
          <span className="dim">생성 위치</span>
          {(
            [
              ["auto", "⚖️ 자동", "규제 소지는 로컬 · 안전한 건 NVIDIA (권장)"],
              ["local", "🖥️ 로컬", "규제 없음·무제한 (로컬 SD 필요)"],
              ["nvidia", "☁️ NVIDIA", "빠름·GPU 불필요 (정책 필터 있음)"],
            ] as const
          ).map(([val, label, tip]) => (
            <button
              key={val}
              className={`art-prov-btn ${artProvider === val ? "on" : ""}`}
              onClick={() => setArtProvider(val)}
              title={tip}
              disabled={artBusy}
            >
              {label}
            </button>
          ))}
          {artProvider === "auto" && (
            <span className="dim art-prov-hint">유혈·무기·성인 등 규제 소지 요청은 자동으로 로컬에서 생성됩니다</span>
          )}
        </div>

        {!connected && artProvider !== "nvidia" && (
          <div className="sd-guide">
            <button className="btn small" onClick={() => setShowGuide(!showGuide)}>
              {showGuide ? "▼" : "▶"} 로컬 Stable Diffusion 설치 안내 (RTX 4060 8GB 기준, 무료)
            </button>
            {showGuide && (
              <ol className="dim">
                <li>
                  <b>Stability Matrix</b>(추천, 원클릭 관리툴) 또는 <b>SD WebUI Forge</b>를 설치:
                  <br />— Forge: github.com/lllyasviel/stable-diffusion-webui-forge → releases에서 one-click 패키지 다운로드 → D:\에 압축 해제
                </li>
                <li>모델(checkpoint) 1개 다운로드 — 컨셉 아트용 추천: <b>DreamShaper 8</b> (SD1.5 계열, 2GB) → models\Stable-diffusion\ 폴더에 넣기</li>
                <li>
                  <b>webui-user.bat</b>을 열어 <code>set COMMANDLINE_ARGS=--api</code> 추가 후 실행
                  <br />(주소가 127.0.0.1:7860이 아니면 VE_SD_URL 환경변수로 지정)
                </li>
                <li>이 창의 <b>🔄 연결 확인</b>을 누르면 완료</li>
              </ol>
            )}
          </div>
        )}

        <div className="art-form">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder={'컨셉 아트 요청을 한국어로 편하게 — 예: "주인공 너구리 수리가 달빛 아래 수리검을 던지는 장면"\n아트 디렉터가 확정된 아트 스타일에 맞춰 프롬프트를 쓰고, 인턴이 생성합니다.'}
            rows={2}
            disabled={artBusy}
          />
          <button
            className="btn primary"
            disabled={!canGenerate || artBusy || !request.trim()}
            onClick={() => void generateArt(request)}
            title={
              canGenerate
                ? "아트 디렉터가 프롬프트를 쓰고 → 선택한 제공자로 생성"
                : artProvider === "local"
                  ? "로컬 Stable Diffusion을 먼저 연결하세요"
                  : "로컬 SD를 연결하거나 NVIDIA 키를 등록하세요"
            }
          >
            {artBusy ? "작업 중…" : "🖌️ 컨셉 아트 생성"}
          </button>
        </div>
        {(artBusy || artPhase) && (
          <div className={`art-phase ${artPhase.startsWith("⚠️") ? "error" : ""}`}>
            {artBusy && <span className="spinner" />} {artPhase}
          </div>
        )}

        <div className="art-gallery">
          {artImages.length === 0 && !artBusy && (
            <div className="empty-hint">
              아직 생성된 컨셉 아트가 없습니다.
              {connected ? " 위에 요청을 입력해 보세요." : " Stable Diffusion 연결 후 사용할 수 있습니다."}
            </div>
          )}
          {artImages.map((img) => (
            <figure key={img.ts} className="art-item">
              <a href={artFileUrl(activeProject, img.ts)} target="_blank" rel="noreferrer" title={img.prompt}>
                <img src={artFileUrl(activeProject, img.ts)} alt={img.request ?? img.prompt} loading="lazy" />
              </a>
              <figcaption>
                <span className="art-caption" title={`프롬프트: ${img.prompt}`}>
                  {img.provider && (
                    <span className={`art-prov-badge ${img.provider}`}>
                      {img.provider === "nvidia" ? "☁️ NVIDIA" : "🖥️ 로컬"}
                    </span>
                  )}
                  {img.request || img.prompt.slice(0, 60)}
                </span>
                <button
                  className="btn tiny"
                  disabled={attached.includes(img.ts)}
                  onClick={() => {
                    void attachArtToGdd(img.ts).then(() => setAttached((a) => [...a, img.ts]));
                  }}
                  title='GDD "8. 아트" 섹션에 이미지로 삽입 (직전 버전 자동 백업)'
                >
                  {attached.includes(img.ts) ? "✓ 삽입됨" : "📌 GDD"}
                </button>
                <button
                  className="btn tiny"
                  onClick={() => {
                    void uiConfirm("이 컨셉 아트를 삭제할까요?", {
                      message: "휴지통(.trash)으로 이동합니다.",
                      confirmLabel: "🗑 삭제",
                      danger: true,
                    }).then((ok) => ok && void removeArt(img.ts));
                  }}
                >
                  🗑
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
