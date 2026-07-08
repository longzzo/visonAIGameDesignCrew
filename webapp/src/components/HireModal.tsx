import { useMemo, useState } from "react";
import { useVE } from "../store";
import { RANK_LABEL, deptManagerId, membersOfZone, type Rank } from "../lib/agents";
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
  useVE((s) => s.rosterVersion);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [emoji, setEmoji] = useState("🙋");
  const [role, setRole] = useState("");
  const [zone, setZone] = useState("plan");
  const [rank, setRank] = useState<Rank>("senior");
  const [reportsTo, setReportsTo] = useState("");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);

  // 주니어·인턴은 같은 부서 시니어(멘토)에게, 그 외는 부서 팀장/대표에게 보고
  const mentorOptions = useMemo(
    () => membersOfZone(zone, false).filter((a) => a.rank === "senior" || a.rank === "manager"),
    [zone]
  );
  const isMentee = rank === "junior" || rank === "intern";
  const resolvedReportsTo = isMentee ? reportsTo || mentorOptions[0]?.id || deptManagerId(zone) : rank === "manager" ? "pm" : deptManagerId(zone);

  const canSubmit = name.trim() && role.trim() && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id) && (!isMentee || !!resolvedReportsTo);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await hireAgentAction({ id, name: name.trim(), emoji, role: role.trim(), zone, persona, rank, reportsTo: resolvedReportsTo });
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
            <label>직급</label>
            <div className="hire-depts">
              {(["manager", "senior", "junior", "intern"] as Rank[]).map((r) => (
                <button key={r} className={`scope-mode ${rank === r ? "on" : ""}`} onClick={() => setRank(r)}>
                  {RANK_LABEL[r]}
                </button>
              ))}
            </div>
            <span className="dim" style={{ fontSize: 11 }}>
              {rank === "manager"
                ? "팀장 — 부서 산출물을 취합·검수해 대표(PM)에 상신합니다. 섹션은 담당하지 않습니다."
                : rank === "senior"
                  ? "시니어 — 자기 파트(GDD 섹션)를 주도합니다."
                  : "주니어·인턴 — 섹션 없이 멘토 시니어의 파트에 기여(세부 조사·초안)합니다."}
            </span>
          </div>
          {isMentee && (
            <div className="hire-row">
              <label>보고 대상 (멘토)</label>
              <select className="model-select" value={reportsTo || mentorOptions[0]?.id || ""} onChange={(e) => setReportsTo(e.target.value)}>
                {mentorOptions.length === 0 && <option value="">(이 부서에 시니어 없음 — 팀장에 보고)</option>}
                {mentorOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.name} ({RANK_LABEL[m.rank ?? "senior"]})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="dim hire-note">
            {rank === "junior" || rank === "intern"
              ? "기여자(주니어·인턴)는 GDD 섹션 없이 멘토의 파트를 돕고, 인력 배치·1:1 대화에 참여합니다."
              : "시니어·팀장은 마스터 GDD의 신규 섹션(12번~)을 담당하고, 회의·협업·1:1에 바로 참여합니다."}
            {" "}두뇌(모델)는 기본 모델로 시작 — 프로필에서 개별 변경 가능.
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
