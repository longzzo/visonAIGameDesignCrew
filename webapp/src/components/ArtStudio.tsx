import { useEffect, useState } from "react";
import { artFileUrl } from "../lib/art";
import { useVE } from "../store";

/**
 * 아트 스튜디오 — 아트 인턴(로컬 Stable Diffusion) 작업실.
 * 오너 요청 → 아트 디렉터가 확정 아트 방향에 맞는 SD 프롬프트 작성 → 인턴이 생성.
 */
export function ArtStudio({ onClose }: { onClose: () => void }) {
  const { activeProject, artStatus, checkArtStatus, artImages, artBusy, artPhase, generateArt, removeArt, attachArtToGdd } =
    useVE();
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

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window art-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">🖌️ 아트 스튜디오 — 아트 인턴</div>
            <div className="head-role dim">
              {connected ? (
                <>로컬 Stable Diffusion 연결됨 ✓ ({artStatus?.url})</>
              ) : (
                <>Stable Diffusion 미연결 — 아래 안내를 따라 설치·실행하면 활성화됩니다</>
              )}
            </div>
          </div>
          <button className="btn small" onClick={() => void checkArtStatus()}>
            🔄 연결 확인
          </button>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        {!connected && (
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
            disabled={!connected || artBusy || !request.trim()}
            onClick={() => void generateArt(request)}
            title={connected ? "아트 디렉터 프롬프트 → 로컬 SD 생성" : "Stable Diffusion을 먼저 연결하세요"}
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
                <span className="art-caption" title={`SD 프롬프트: ${img.prompt}`}>
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
                    if (window.confirm("이 컨셉 아트를 삭제할까요?")) void removeArt(img.ts);
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
