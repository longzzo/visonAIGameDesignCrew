import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, DEV_TEAM } from "../lib/agents";
import { runDevTask, runDevMeeting, type DevStep } from "../lib/devtask";
import { fetchMcp } from "../lib/mcp";
import { notify } from "../lib/notify";

/**
 * 개발 작업 패널 — 개발팀 에이전트에게 실제 작업을 시킨다.
 * OpenClaw 브리지가 아니라 다이렉트 프로바이더(NVIDIA)로 함수호출 루프를 돌며
 * MCP 도구(파일 읽기/쓰기 등)로 진짜 프로젝트 파일에 관여한다.
 */
export function DevTaskPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const a = AGENT_MAP[agentId];
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<DevStep[]>([]);
  const [running, setRunning] = useState(false);
  const [meetingMode, setMeetingMode] = useState(false);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchMcp().then((m) => setToolCount(m.tools.length));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !running && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  const run = async () => {
    if (!task.trim() || running) return;
    setSteps([]);
    setRunning(true);
    const onStep = (s: DevStep) => {
      setSteps((prev) => [...prev, s]);
      if (s.kind === "done") {
        void notify(meetingMode ? "🤝 개발 회의 완료" : `${a?.emoji} ${a?.name} 작업 완료`, s.final || task.trim());
      }
    };
    try {
      if (meetingMode) await runDevMeeting(agentId, task.trim(), onStep);
      else await runDevTask(agentId, task.trim(), onStep);
    } catch (e: any) {
      setSteps((prev) => [...prev, { kind: "error", text: String(e?.message ?? e) }]);
    }
    setRunning(false);
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="doc-window devtask-panel">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">
              {a?.emoji} {a?.name} — 개발 작업
            </div>
            <div className="head-role dim">
              MCP 도구로 실제 프로젝트 파일에 관여합니다{toolCount !== null ? ` · 사용 가능 도구 ${toolCount}개` : ""}
              {toolCount === 0 && " — 🔌 MCP 패널에서 서버를 켜세요"}
            </div>
          </div>
          <button className="btn small" onClick={onClose} disabled={running} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="art-form">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={'작업을 지시하세요 — 예: "data/stats.csv를 읽고 slime의 hp를 20으로 올려줘", "unity/README.md 확인하고 부족한 부분 보완"'}
            rows={2}
            disabled={running}
          />
          <div className="devtask-run">
            <label className="devtask-mode" title="켜면 구현 → 코드 리뷰어 검토 → 테스트 엔지니어 검증까지 3단계 교차 검증으로 진행합니다 (시간이 더 걸립니다)">
              <input type="checkbox" checked={meetingMode} onChange={(e) => setMeetingMode(e.target.checked)} disabled={running} />
              🤝 회의 모드
            </label>
            <button className="btn primary" onClick={() => void run()} disabled={running || !task.trim()}>
              {running ? "작업 중…" : meetingMode ? "🤝 개발 회의 시작" : "▶ 작업 시작"}
            </button>
          </div>
        </div>

        <div className="devtask-log">
          {steps.length === 0 && !running && (
            <div className="empty-hint">
              개발팀은 OpenClaw가 아니라 다이렉트 프로바이더(NVIDIA 함수호출)로 동작합니다. MCP 도구가 연결돼 있으면 파일을 직접 읽고 수정합니다.
            </div>
          )}
          {steps.map((s, i) => (
            <div key={i} className={`devstep k-${s.kind}`}>
              {s.kind === "phase" && <div className="ds-phase">{s.text}</div>}
              {s.kind === "task" && <div className="ds-task">📋 {s.text}</div>}
              {s.kind === "say" && (
                <div className="ds-say">
                  {s.agent && <b className="ds-agent">{AGENT_MAP[s.agent]?.emoji} {AGENT_MAP[s.agent]?.name}</b>}
                  {s.text}
                </div>
              )}
              {s.kind === "tool" && (
                <div className="ds-tool">
                  🔧 <code>{s.server}·{s.name}</code>
                  <span className="dim"> {JSON.stringify(s.args).slice(0, 120)}</span>
                </div>
              )}
              {s.kind === "toolResult" && (
                <pre className={`ds-result ${s.isError ? "err" : ""}`}>{(s.isError ? "⚠️ " : "✓ ") + (s.text ?? "")}</pre>
              )}
              {s.kind === "done" && <div className="ds-done">✅ {s.final}</div>}
              {s.kind === "error" && <div className="ds-err">⚠️ {s.text}</div>}
            </div>
          ))}
          {running && <div className="devstep dim"><span className="spinner" /> 진행 중…</div>}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

/** 개발팀 여부 */
export function isDevAgent(id: string): boolean {
  return DEV_TEAM.some((a) => a.id === id);
}
