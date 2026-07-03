import { useEffect, useMemo } from "react";
import { diffGddSections } from "../lib/diff";
import { uiConfirm } from "../lib/dialog";
import { useVE } from "../store";

/**
 * 이번 회의 변경 확인 — 회의 시작 시점(orchBaseline)과 현재 GDD를 섹션별로 비교.
 * 자동 반영이 문서를 어떻게 바꿨는지 보여주고, 마음에 안 들면 통째로 되돌린다.
 */
export function DiffViewer() {
  const { orchBaseline, gdd, setMeetingDiffOpen, revertMeeting } = useVE();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMeetingDiffOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMeetingDiffOpen]);

  const sections = useMemo(() => diffGddSections(orchBaseline ?? "", gdd), [orchBaseline, gdd]);

  const onRevert = async () => {
    const ok = await uiConfirm("이번 회의의 변경을 모두 되돌릴까요?", {
      message: "GDD가 회의 시작 시점으로 복원됩니다. 되돌리기 직전본도 🕘 히스토리에 남으므로 다시 복구할 수 있습니다.",
      confirmLabel: "⏪ 되돌리기",
      danger: true,
    });
    if (ok) await revertMeeting();
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && setMeetingDiffOpen(false)}>
      <div className="doc-window diff-viewer">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">🔍 이번 회의 변경 확인</div>
            <div className="head-role dim">
              {sections.length === 0
                ? "회의 전과 달라진 내용이 없습니다"
                : `바뀐 섹션 ${sections.length}개 — 빨강 = 사라진 줄, 초록 = 새 줄`}
            </div>
          </div>
          {sections.length > 0 && (
            <button className="btn small danger" onClick={() => void onRevert()}>
              ⏪ 회의 전으로 되돌리기
            </button>
          )}
          <button className="btn small" onClick={() => setMeetingDiffOpen(false)} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>
        <div className="diff-body">
          {sections.length === 0 && <div className="empty-hint">변경 사항이 없습니다.</div>}
          {sections.map((s) => (
            <details key={s.heading} className="diff-section" open={sections.length <= 4}>
              <summary>
                <b>{s.heading}</b>
                <span className="diff-stat">
                  <span className="add">+{s.added}</span> <span className="del">−{s.removed}</span>
                </span>
              </summary>
              <pre className="diff-lines">
                {s.lines.map((l, i) => (
                  <div key={i} className={`diff-line ${l.type}`}>
                    <span className="diff-mark">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
                    {l.text || " "}
                  </div>
                ))}
              </pre>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
