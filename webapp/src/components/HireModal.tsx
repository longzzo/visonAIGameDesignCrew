import { useState } from "react";
import { useVE } from "../store";
import { ZONES } from "../lib/zones";
import { uiAlert } from "../lib/dialog";

/**
 * 직원 채용 모달 — 이름·역할·부서·페르소나를 정하면 서버가
 * ① agents/<id>/AGENTS.md 페르소나 생성 ② OpenClaw 설정에 에이전트 추가
 * ③ 게이트웨이 재시작(~10초). 새 직원은 3D 사무실 부서 게스트 좌석에 앉고,
 * 회의(오케스트레이션)·협업·1:1 대화에 참여하며 GDD 신규 섹션(12번~)을 담당한다.
 */
const HIRE_EMOJIS = ["🙋", "🎧", "🎼", "🗺️", "📽️", "🧵", "🧿", "🦊", "🤖", "🐙"];
const HIRE_DEPTS = ZONES.filter((z) => ["plan", "dev", "biz", "art", "qa"].includes(z.id));

export function HireModal({ onClose }: { onClose: () => void }) {
  const hireAgentAction = useVE((s) => s.hireAgentAction);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [emoji, setEmoji] = useState("🙋");
  const [role, setRole] = useState("");
  const [zone, setZone] = useState("plan");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim() && role.trim() && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await hireAgentAction({ id, name: name.trim(), emoji, role: role.trim(), zone, persona });
      onClose();
      void uiAlert(
        "👋 채용 완료",
        `${emoji} ${name.trim()} 님이 입사했습니다. 게이트웨이가 재시작 중이라 약 10초 뒤부터 대화·회의에 참여할 수 있습니다.`
      );
    } catch (e: any) {
      void uiAlert("채용 실패", String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window hire-modal">
        <div className="doc-head">
          <b>➕ 직원 채용</b>
          <span className="dim">새 전문가를 팀에 합류시킵니다 — 게이트웨이 재시작 약 10초</span>
          <button className="btn small" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>
        <div className="hire-body">
          <div className="hire-row">
            <label>이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 사운드 디자이너"
              maxLength={30}
            />
          </div>
          <div className="hire-row">
            <label>영문 id</label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              placeholder="영문 소문자·숫자·하이픈 (예: sound)"
              maxLength={20}
            />
          </div>
          <div className="hire-row">
            <label>이모지</label>
            <div className="hire-emojis">
              {HIRE_EMOJIS.map((e) => (
                <button key={e} className={`hire-emoji ${emoji === e ? "on" : ""}`} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="hire-row">
            <label>역할 한 줄</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="예: BGM·효과음 디렉션, 사운드 에셋 목록 관리"
              maxLength={60}
            />
          </div>
          <div className="hire-row">
            <label>배치 부서</label>
            <div className="hire-depts">
              {HIRE_DEPTS.map((z) => (
                <button key={z.id} className={`scope-mode ${zone === z.id ? "on" : ""}`} onClick={() => setZone(z.id)}>
                  <span className="o3d-dot" style={{ background: z.dot }} /> {z.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hire-row">
            <label>페르소나 (선택)</label>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={5}
              placeholder={"이 직원의 말투·전문성·규칙을 마크다운으로.\n비워두면 기본 페르소나가 만들어지고, 입사 후 프로필의 📝 페르소나 편집에서 다듬을 수 있습니다."}
            />
          </div>
          <div className="dim hire-note">
            새 직원은 마스터 GDD의 신규 섹션(12번부터)을 담당하고, 인력 배치·협업 세션·1:1 대화에 바로 참여합니다.
            두뇌(모델)는 현재 기본 모델로 시작 — 프로필에서 개별 변경 가능합니다.
          </div>
          <div className="hire-actions">
            <button className="btn primary" onClick={() => void submit()} disabled={!canSubmit || busy}>
              {busy ? "채용 중… (게이트웨이 재시작)" : "✅ 채용하기"}
            </button>
            <button className="btn" onClick={onClose} disabled={busy}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
