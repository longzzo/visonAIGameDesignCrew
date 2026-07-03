import { useEffect, useState } from "react";
import { prototypeFileUrl } from "../lib/proto";
import { uiConfirm } from "../lib/dialog";
import { useVE } from "../store";

/**
 * 프로토타입 스튜디오 — 개발 인턴 작업실.
 * 선임 개발자(td)가 확정한 개발 명세 중 기능 하나를 골라 요청하면,
 * 인턴이 클릭 가능한 HTML 페이퍼 프로토타입 한 장을 만들어낸다.
 */
export function PrototypeStudio({ onClose }: { onClose: () => void }) {
  const { activeProject, protoList, protoBusy, protoPhase, generatePrototype, removePrototype } = useVE();
  const [feature, setFeature] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window art-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">🧑‍💻 프로토타입 스튜디오 — 개발 인턴</div>
            <div className="head-role dim">선임 개발자가 확정한 개발 명세 중 기능 하나를 골라 HTML 페이퍼 프로토타입을 뽑습니다</div>
          </div>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="art-form">
          <textarea
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            placeholder={'만들 기능을 한국어로 편하게 — 예: "인벤토리 화면", "일일 퀘스트 보드"\n선임 개발자의 개발 명세("9. 기술" 섹션)를 근거로 인턴이 화면 흐름을 뽑습니다.'}
            rows={2}
            disabled={protoBusy}
          />
          <button
            className="btn primary"
            disabled={protoBusy || !feature.trim()}
            onClick={() => void generatePrototype(feature)}
            title="선임 개발자 명세 확인 → 개발 인턴이 HTML 프로토타입 생성"
          >
            {protoBusy ? "작업 중…" : "🧑‍💻 프로토타입 생성"}
          </button>
        </div>
        {(protoBusy || protoPhase) && (
          <div className={`art-phase ${protoPhase.startsWith("⚠️") ? "error" : ""}`}>
            {protoBusy && <span className="spinner" />} {protoPhase}
          </div>
        )}

        <div className="art-gallery proto-gallery">
          {protoList.length === 0 && !protoBusy && (
            <div className="empty-hint">아직 만든 프로토타입이 없습니다. 위에 기능 이름을 입력해 보세요.</div>
          )}
          {protoList.map((p) => (
            <figure key={p.ts} className="art-item proto-item">
              <a href={prototypeFileUrl(activeProject, p.ts)} target="_blank" rel="noreferrer" title={p.feature}>
                <iframe
                  src={prototypeFileUrl(activeProject, p.ts)}
                  title={p.feature}
                  className="proto-frame"
                  sandbox="allow-scripts"
                />
              </a>
              <figcaption>
                <span className="art-caption" title={p.feature}>
                  {p.feature}
                </span>
                <a
                  className="btn tiny"
                  href={prototypeFileUrl(activeProject, p.ts)}
                  target="_blank"
                  rel="noreferrer"
                  title="새 탭에서 열기"
                >
                  ↗ 열기
                </a>
                <button
                  className="btn tiny"
                  onClick={() => {
                    void uiConfirm("이 프로토타입을 삭제할까요?", {
                      message: "휴지통(.trash)으로 이동합니다.",
                      confirmLabel: "🗑 삭제",
                      danger: true,
                    }).then((ok) => ok && void removePrototype(p.ts));
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
