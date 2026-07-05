import { useState } from "react";
import { registerModelKey, getModelsInfo } from "../lib/models";

/**
 * 첫 실행 온보딩 — 두 갈래로 나눈다:
 *   · 접속 버전: 이미 세팅된 서버(예: 다른 PC/노트북)를 쓴다. 키는 서버에 있으니 바로 시작.
 *   · 커스텀 버전: 내가 직접 모델을 고르고 키를 넣는다. 로컬(Ollama) 우선 권장.
 * localStorage "ve-onboarded"로 한 번만 뜬다.
 */
const DONE_KEY = "ve-onboarded";

export function markOnboarded() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* noop */
  }
}
export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== "1";
  } catch {
    return false;
  }
}

type Path = null | "connect" | "custom";
type Provider = "ollama" | "nvidia" | "github";

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState<Path>(null);
  const [provider, setProvider] = useState<Provider>("ollama");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const finish = () => {
    markOnboarded();
    onClose();
  };

  const saveCustom = async () => {
    setBusy(true);
    setMsg("");
    try {
      if (provider === "ollama") {
        // 로컬은 키 불필요 — 설치·모델 존재만 안내
        const info = await getModelsInfo();
        if (!info.providers.ollama) {
          setMsg("⚠️ Ollama가 감지되지 않았습니다. ollama.com에서 설치하고 `ollama pull qwen2.5:7b` 후 다시 시도하세요.");
          setBusy(false);
          return;
        }
        finish();
        return;
      }
      if (!key.trim()) {
        setMsg("API 키를 입력하세요.");
        setBusy(false);
        return;
      }
      await registerModelKey(provider, key.trim());
      finish();
    } catch (e: any) {
      setMsg("⚠️ " + String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <div className="onb-backdrop">
      <div className="onb-card">
        <div className="onb-brand">
          <span className="onb-logo">🏢</span>
          <div>
            <div className="onb-title">Vision Engine에 오신 걸 환영합니다</div>
            <div className="onb-sub dim">게임 기획부터 개발까지, AI 팀과 함께.</div>
          </div>
        </div>

        {path === null && (
          <>
            <div className="onb-q">어떻게 시작할까요?</div>
            <div className="onb-choices">
              <button className="onb-choice" onClick={() => setPath("connect")}>
                <div className="onb-choice-icon">🔗</div>
                <div className="onb-choice-title">접속해서 쓰기</div>
                <div className="onb-choice-desc dim">
                  이미 세팅된 서버(내 노트북·다른 PC)에 연결합니다. API 키는 그 서버에 있어서 바로 시작할 수 있어요.
                </div>
              </button>
              <button className="onb-choice" onClick={() => setPath("custom")}>
                <div className="onb-choice-icon">🔧</div>
                <div className="onb-choice-title">직접 설정하기</div>
                <div className="onb-choice-desc dim">
                  내 컴퓨터에서 직접 돌립니다. 어떤 AI 모델을 쓸지 고르고 필요하면 API 키를 넣어요.
                </div>
              </button>
            </div>
          </>
        )}

        {path === "connect" && (
          <>
            <div className="onb-q">접속 버전 — 바로 시작</div>
            <p className="onb-p dim">
              이 창은 이미 서버에 연결돼 있습니다. 서버에 등록된 모델·키를 그대로 사용합니다.
              <br />
              다른 PC에서 이 프로그램(데스크톱 앱)을 쓰는 경우, 앱의 서버 주소 설정에서 서버 PC의 주소를 넣으면 됩니다.
            </p>
            <div className="onb-actions">
              <button className="btn" onClick={() => setPath(null)}>
                ← 뒤로
              </button>
              <button className="btn primary" onClick={finish}>
                시작하기 →
              </button>
            </div>
          </>
        )}

        {path === "custom" && (
          <>
            <div className="onb-q">직접 설정 — 모델 선택</div>
            <div className="onb-providers">
              <button
                className={`onb-prov ${provider === "ollama" ? "on" : ""}`}
                onClick={() => setProvider("ollama")}
              >
                <b>🖥️ 로컬 Ollama</b>
                <span className="onb-tag ok">추천 · 무료 · 오프라인</span>
                <span className="dim">내 PC에서 실행. 키 불필요. 데이터가 밖으로 안 나감.</span>
              </button>
              <button
                className={`onb-prov ${provider === "nvidia" ? "on" : ""}`}
                onClick={() => setProvider("nvidia")}
              >
                <b>☁️ NVIDIA (클라우드)</b>
                <span className="onb-tag">무료 티어 · 빠르고 품질 높음</span>
                <span className="dim">build.nvidia.com에서 무료 키 발급. 과도기용 — 로컬이 궁극 목표.</span>
              </button>
              <button
                className={`onb-prov ${provider === "github" ? "on" : ""}`}
                onClick={() => setProvider("github")}
              >
                <b>☁️ GitHub Models</b>
                <span className="onb-tag warn">유료 결제 필요</span>
                <span className="dim">무료 티어는 토큰 한도가 낮아 실사용 불가. 유료 시에만.</span>
              </button>
            </div>

            {provider !== "ollama" && (
              <input
                className="onb-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider === "nvidia" ? "nvapi-... (build.nvidia.com에서 발급)" : "GitHub PAT (models:read 권한)"}
                spellCheck={false}
              />
            )}
            {provider === "ollama" && (
              <p className="onb-p dim">
                Ollama가 설치돼 있고 모델(예: <code>qwen2.5:7b</code>)이 받아져 있으면 바로 시작됩니다.
                아직이면 <b>ollama.com</b>에서 설치 후 <code>ollama pull qwen2.5:7b</code>.
              </p>
            )}
            {msg && <div className="onb-msg">{msg}</div>}

            <div className="onb-actions">
              <button className="btn" onClick={() => setPath(null)} disabled={busy}>
                ← 뒤로
              </button>
              <button className="btn primary" onClick={() => void saveCustom()} disabled={busy}>
                {busy ? "설정 중…" : provider === "ollama" ? "로컬로 시작 →" : "키 저장하고 시작 →"}
              </button>
            </div>
          </>
        )}

        <button className="onb-skip" onClick={finish}>
          나중에 설정 · 건너뛰기
        </button>
      </div>
    </div>
  );
}
