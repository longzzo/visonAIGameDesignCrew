import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, DEV_TEAM } from "../lib/agents";
import { runDevTask, runDevMeeting, type DevEngine, type DevStep } from "../lib/devtask";
import { fetchMcp } from "../lib/mcp";
import { notify } from "../lib/notify";
import { UnityPreviewPane } from "./UnityPreviewPane";

/**
 * 개발 작업 패널 — 개발팀 에이전트에게 실제 작업을 시킨다.
 * Claude Code가 계획·검토하고 Codex가 구현하는 구독 실행 또는 고급 제공자 모드로 실제 프로젝트에 관여한다.
 */
export function DevTaskPanel({
  agentId,
  onClose,
  initialTask,
  autoMeeting,
  unityMode = false,
}: {
  agentId: string;
  onClose: () => void;
  initialTask?: string;
  autoMeeting?: boolean;
  unityMode?: boolean;
}) {
  const a = AGENT_MAP[agentId];
  const [task, setTask] = useState(initialTask ?? "");
  const [steps, setSteps] = useState<DevStep[]>([]);
  const [running, setRunning] = useState(false);
  const [meetingMode, setMeetingMode] = useState(!!autoMeeting);
  const [engine, setEngine] = useState<DevEngine>(() => {
    const saved = localStorage.getItem("ve-dev-engine");
    return saved === "claude" || saved === "codex" || saved === "provider" || saved === "subscription" ? saved : "subscription";
  });
  const [toolCount, setToolCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchMcp(agentId).then((m) => setToolCount(m.tools.length));
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
      if (meetingMode) await runDevMeeting(agentId, task.trim(), onStep, engine);
      else await runDevTask(agentId, task.trim(), onStep, undefined, engine);
    } catch (e: any) {
      setSteps((prev) => [...prev, { kind: "error", text: String(e?.message ?? e) }]);
    }
    setRunning(false);
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className={`doc-window devtask-panel ${unityMode ? "unity-workspace" : ""}`}>
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">
              {unityMode ? "🎮 Unity 개발 워크스페이스" : `${a?.emoji ?? ""} ${a?.name ?? "개발자"} — 개발 작업`}
            </div>
            <div className="head-role dim">
              {unityMode ? `${a?.name ?? "선임 개발자"} 작업 로그와 WebGL 실행 화면을 함께 봅니다` : "MCP 도구로 실제 프로젝트 파일에 관여합니다"}
              {toolCount !== null ? ` · 사용 가능 도구 ${toolCount}개` : ""}
              {toolCount === 0 && " — 🔌 MCP 패널에서 서버를 켜세요"}
            </div>
          </div>
          <button className="btn small" onClick={onClose} disabled={running} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="devtask-workspace-body">
          <div className="devtask-control-column">
            <div className="art-form">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder={'작업을 지시하세요 — 예: "플레이어 이동 코드를 점검하고 WebGL 입력 문제를 수정해줘"'}
                rows={unityMode ? 4 : 2}
                disabled={running}
              />
              <div className="devtask-run">
                <label className="devtask-mode" title="구독 팀은 Claude Code가 계획·검토하고 Codex가 작업 폴더 안에서 구현합니다. API 키를 사용하지 않습니다.">
                  실행 엔진{" "}
                  <select
                    value={engine}
                    onChange={(e) => {
                      const next = e.target.value as DevEngine;
                      setEngine(next);
                      localStorage.setItem("ve-dev-engine", next);
                    }}
                    disabled={running}
                  >
                    <option value="subscription">Claude × Codex 구독 팀 (권장)</option>
                    <option value="codex">Codex 구독 · 구현</option>
                    <option value="claude">Claude 구독 · 읽기 전용</option>
                    <option value="provider">MCP/API 제공자 · 고급</option>
                  </select>
                </label>
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
                  {unityMode
                    ? "Unity 프로젝트와 Codex 작업 폴더를 같은 경로로 연결한 뒤 작업을 시작하세요. WebGL 빌드는 오른쪽에서 계속 확인할 수 있습니다."
                    : "기본 모드는 Claude Code 구독으로 계획·검토하고 Codex 구독의 작업공간 쓰기 샌드박스로 구현합니다. 키 기반 제공자는 고급 모드에서만 사용합니다."}
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
          {unityMode && <UnityPreviewPane running={running} />}
        </div>
      </div>
    </div>
  );
}

/** 개발팀 여부 */
export function isDevAgent(id: string): boolean {
  return DEV_TEAM.some((a) => a.id === id);
}
