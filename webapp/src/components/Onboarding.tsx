import { useEffect, useRef, useState } from "react";
import { registerModelKey, getModelsInfo } from "../lib/models";
import { downloadBackup, getBackupStatus, restoreBackup, type BackupStatus } from "../lib/backup";
import { uiConfirm } from "../lib/dialog";

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

type Path = null | "connect" | "custom" | "pc";
type Provider = "ollama" | "nvidia" | "github";
type Readiness = {
  gateway: { running: boolean; configured: boolean; agents: number; installed?: boolean; version?: string };
  ollama: { running: boolean; version?: string; models?: string[]; runningModels?: string[]; recommendedModel?: string; recommendedInstalled?: boolean };
  codex: { installed: boolean; authenticated: boolean; detail: string; workdir: { dir: string; exists: boolean; writable: boolean; configured: boolean } };
  data: { projects: number; root?: string; migration?: { source?: string } | null };
  desktop: boolean;
};
type UpdateState = {
  status: string;
  version?: string;
  progress?: number;
  message: string;
  currentVersion: string;
};

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState<Path>(null);
  const [provider, setProvider] = useState<Provider>("ollama");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState<Readiness | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const refreshBackupStatus = async () => {
    try { setBackup(await getBackupStatus()); }
    catch { setBackup(null); }
  };

  const refreshReadiness = async () => {
    try {
      const response = await fetch("/api/readiness", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "준비 상태 확인 실패");
      setReady(body);
    } catch (error: any) {
      setMsg(`⚠️ ${String(error?.message || error)}`);
    }
  };

  useEffect(() => {
    void refreshReadiness();
    void refreshBackupStatus();
    const desktop = (window as any).veDesktop;
    if (desktop?.getUpdateState) void desktop.getUpdateState().then((state: UpdateState) => setUpdate(state)).catch(() => {});
  }, []);

  const postReadiness = async (body: Record<string, string>) => {
    const response = await fetch("/api/readiness", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "설정 실패");
    await refreshReadiness();
  };

  const chooseCodexWorkdir = async () => {
    setBusy(true); setMsg("");
    try {
      const desktop = (window as any).veDesktop;
      if (!desktop?.chooseDirectory) throw new Error("PC 앱에서만 폴더 선택 창을 열 수 있습니다.");
      const dir = await desktop.chooseDirectory("Codex가 코딩할 프로젝트 폴더 선택");
      if (dir) { await postReadiness({ action: "set-codex-workdir", dir }); setMsg("✅ Codex 작업 폴더를 저장했습니다."); }
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally { setBusy(false); }
  };

  const importExistingData = async () => {
    setBusy(true); setMsg("");
    try {
      const desktop = (window as any).veDesktop;
      if (!desktop?.chooseDirectory) throw new Error("PC 앱에서만 기존 폴더를 선택할 수 있습니다.");
      const source = await desktop.chooseDirectory("기존 Vision Engine 프로젝트 루트 선택");
      if (source) { await postReadiness({ action: "import-data", source }); setMsg("✅ 기존 프로젝트를 비파괴 방식으로 가져왔습니다."); }
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally { setBusy(false); }
  };

  const loginCodex = async () => {
    setMsg("");
    const desktop = (window as any).veDesktop;
    if (!desktop?.codexLogin) { setMsg("⚠️ PC 앱에서 실행하세요. 터미널에서는 `codex login`을 사용할 수 있습니다."); return; }
    const result = await desktop.codexLogin();
    setMsg(result?.ok ? "브라우저 로그인 창을 열었습니다. 완료 후 ‘다시 확인’을 누르세요." : `⚠️ ${result?.error || "로그인 창을 열지 못했습니다."}`);
  };

  const startOpenClaw = async () => {
    try {
      const desktop = (window as any).veDesktop;
      if (desktop?.startOpenClaw) {
        const result = await desktop.startOpenClaw();
        if (result?.ok === false) throw new Error(result.error || "Gateway 시작 실패");
      }
      else await fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restart: "gateway" }) });
      setMsg("OpenClaw Gateway 시작을 요청했습니다. 잠시 후 다시 확인하세요.");
      setTimeout(() => void refreshReadiness(), 2500);
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
  };

  const onboardOpenClaw = async () => {
    const desktop = (window as any).veDesktop;
    if (!desktop?.openclawOnboard) { setMsg("⚠️ PC 앱에서 실행하거나 터미널에서 `openclaw onboard`를 실행하세요."); return; }
    const result = await desktop.openclawOnboard();
    setMsg(result?.ok ? "OpenClaw 온보딩 창을 열었습니다. 완료 후 Gateway 시작을 누르세요." : `⚠️ ${result?.error || "온보딩 창을 열지 못했습니다."}`);
  };

  const configureOpenClawSecrets = async () => {
    const desktop = (window as any).veDesktop;
    if (!desktop?.openclawSecrets) { setMsg("⚠️ PC 앱에서 실행하거나 터미널에서 `openclaw secrets configure`를 실행하세요."); return; }
    const result = await desktop.openclawSecrets();
    setMsg(result?.ok ? "OpenClaw 비밀키 보안 설정 창을 열었습니다." : `⚠️ ${result?.error || "비밀키 설정 창을 열지 못했습니다."}`);
  };

  const protectOpenClawSecrets = async () => {
    const desktop = (window as any).veDesktop;
    if (!desktop?.protectOpenClawSecrets) {
      setMsg("⚠️ 최신 PC 앱에서만 자동 보호할 수 있습니다.");
      return;
    }
    const proceed = await uiConfirm("평문 공급자 키를 보호할까요?", {
      message: "GitHub Models·NVIDIA·Brave 키를 OpenClaw의 쓰기 전용 보호 저장소로 옮기고 기존 설정·인증 캐시의 평문을 지웁니다. Gateway 토큰은 실시간 이벤트 기능을 위해 유지합니다.",
      confirmLabel: "보호 저장소로 이전",
      cancelLabel: "취소",
      danger: true,
    });
    if (!proceed) return;
    setBusy(true);
    setMsg("비밀키를 보호 저장소로 이전하고 감사를 실행하는 중…");
    try {
      const result = await desktop.protectOpenClawSecrets();
      if (!result?.ok) throw new Error(result?.error || "비밀키 보호를 완료하지 못했습니다.");
      const count = Array.isArray(result.migrated) ? result.migrated.length : 0;
      setMsg(count > 0
        ? `🔐 공급자 키 ${count}개를 보호했습니다. Gateway 토큰 1건만 별도 개선 대상으로 남습니다.`
        : "🔐 이전할 평문 공급자 키가 없습니다.");
      await refreshReadiness();
    } catch (error: any) {
      setMsg(`⚠️ ${String(error?.message || error)}`);
    } finally {
      setBusy(false);
    }
  };

  const pullRecommendedModel = async () => {
    setMsg("");
    const desktop = (window as any).veDesktop;
    if (!desktop?.ollamaPull) {
      setMsg("⚠️ PC 앱에서 실행하거나 터미널에서 `ollama pull qwen3.5:4b`를 실행하세요.");
      return;
    }
    const model = ready?.ollama.recommendedModel || "qwen3.5:4b";
    const result = await desktop.ollamaPull(model);
    setMsg(result?.ok
      ? `${model} 다운로드 창을 열었습니다. 완료되면 ‘다시 확인’을 누르세요.`
      : `⚠️ ${result?.error || "모델 다운로드 창을 열지 못했습니다."}`);
  };

  const exportSupportReport = async () => {
    setBusy(true); setMsg("");
    try {
      const desktop = (window as any).veDesktop;
      if (!desktop?.exportSupportReport) throw new Error("PC 앱에서만 진단 보고서를 저장할 수 있습니다.");
      const result = await desktop.exportSupportReport();
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || "진단 보고서를 저장하지 못했습니다.");
      setMsg(`✅ 민감한 키를 제외한 진단 보고서를 저장했습니다: ${result.file}`);
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally { setBusy(false); }
  };

  const checkDesktopUpdate = async () => {
    setBusy(true); setMsg("");
    try {
      const desktop = (window as any).veDesktop;
      if (!desktop?.checkForUpdates) throw new Error("PC 앱에서만 업데이트를 확인할 수 있습니다.");
      const result = await desktop.checkForUpdates();
      setUpdate(result);
      setMsg(result?.ok ? `✅ ${result.message}` : `⚠️ ${result?.message || "업데이트를 확인하지 못했습니다."}`);
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally { setBusy(false); }
  };

  const exportProjects = async () => {
    setBusy(true); setMsg("");
    try {
      await downloadBackup();
      setMsg("✅ 전체 프로젝트 백업 다운로드를 시작했습니다. 안전한 별도 드라이브나 클라우드에 보관하세요.");
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally { setBusy(false); }
  };

  const importProjects = async (file: File) => {
    const proceed = await uiConfirm("프로젝트 백업을 복원할까요?", {
      message: "현재 프로젝트는 덮어쓰지 않습니다. 같은 프로젝트가 있으면 이름에 ‘복원본’을 붙인 새 사본으로 가져옵니다.",
      confirmLabel: "♻️ 비파괴 복원",
    });
    if (!proceed) {
      if (backupInput.current) backupInput.current.value = "";
      return;
    }
    setBusy(true); setMsg("");
    try {
      const result = await restoreBackup(file);
      const copies = result.imported.filter((item) => item.copied).length;
      setMsg(`✅ 프로젝트 ${result.imported.length}개·파일 ${result.files.toLocaleString()}개를 복원했습니다.${copies ? ` 기존 프로젝트 ${copies}개는 복원본 사본으로 만들었습니다.` : ""}`);
      await Promise.all([refreshReadiness(), refreshBackupStatus()]);
    } catch (error: any) { setMsg(`⚠️ ${String(error?.message || error)}`); }
    finally {
      setBusy(false);
      if (backupInput.current) backupInput.current.value = "";
    }
  };

  // 닫는 중 — 투명 방패를 잠깐 유지한다.
  //
  // 오너 실측 2026-07-26 (C-3): "건너뛰기"를 눌렀는데 **뒤에 있던 "📥 기존 기획 팀 리뷰"가 실행돼**
  // 의도치 않은 회의가 통째로 돌았다(토큰·시간 낭비 + C-1의 방아쇠). 오버레이가 즉시 언마운트되면
  // pointerdown 이후에 도착하는 click/mouseup이 그 자리에 새로 나타난 버튼으로 떨어진다.
  // 방패를 400ms 더 씌워 그 클릭을 흡수한다. 짧아서 사용자는 못 느낀다.
  const [closing, setClosing] = useState(false);

  const finish = () => {
    markOnboarded();
    setClosing(true);
    setTimeout(onClose, 400);
  };

  const saveCustom = async () => {
    setBusy(true);
    setMsg("");
    try {
      if (provider === "ollama") {
        // 로컬은 키 불필요 — 설치·모델 존재만 안내
        const info = await getModelsInfo();
        if (!info.providers.ollama) {
          setMsg("⚠️ Ollama가 감지되지 않았습니다. ollama.com에서 설치하고 `ollama pull qwen3.5:4b` 후 다시 시도하세요.");
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

  if (closing) {
    // 카드는 사라지고 클릭만 막는 투명 방패 (위 finish 주석 참조)
    return <div className="onb-shield" onClick={(e) => e.stopPropagation()} />;
  }

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
              <button className="onb-choice" onClick={() => setPath("pc")}>
                <div className="onb-choice-icon">🖥️</div>
                <div className="onb-choice-title">PC 앱 준비 확인</div>
                <div className="onb-choice-desc dim">
                  기존 프로젝트를 가져오고 OpenClaw·Codex 로그인·코딩 폴더를 한 번에 점검합니다.
                </div>
              </button>
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

        {path === "pc" && (
          <>
            <div className="onb-q">PC 앱 실행 준비</div>
            {!ready ? <p className="onb-p dim">상태를 확인하는 중…</p> : (
              <div className="onb-ready-grid">
                <div className={`onb-ready ${ready.data.projects > 0 ? "ok" : "warn"}`}>
                  <b>{ready.data.projects > 0 ? "✅" : "⚠️"} 프로젝트 데이터</b>
                  <span>{ready.data.projects}개 · {ready.data.root || "원격 서버"}</span>
                  <button className="btn tiny" onClick={() => void importExistingData()} disabled={busy}>기존 데이터 가져오기</button>
                </div>
                <div className={`onb-ready ${ready.gateway.running ? "ok" : "warn"}`}>
                  <b>{ready.gateway.running ? "✅" : "⚠️"} OpenClaw Gateway</b>
                  <span>{ready.gateway.running ? `실행 중 · 에이전트 ${ready.gateway.agents}명` : ready.gateway.configured ? "설정됨 · 현재 중지" : "초기 설정 필요"}{ready.gateway.version ? ` · v${ready.gateway.version}` : ""}</span>
                  <div className="onb-ready-actions">
                    <button className="btn tiny" onClick={() => void startOpenClaw()}>Gateway 시작</button>
                    {!ready.gateway.running && <button className="btn tiny" onClick={() => void onboardOpenClaw()}>OpenClaw 온보딩</button>}
                    <button className="btn tiny" onClick={() => void protectOpenClawSecrets()} disabled={busy}>평문 키 자동 보호</button>
                    <button className="btn tiny" onClick={() => void configureOpenClawSecrets()}>고급 비밀키 설정</button>
                  </div>
                </div>
                <div className={`onb-ready ${ready.ollama.running && ready.ollama.recommendedInstalled ? "ok" : "warn"}`}>
                  <b>{ready.ollama.running && ready.ollama.recommendedInstalled ? "✅" : "⚠️"} 로컬 AI · Ollama</b>
                  <span>{ready.ollama.running
                    ? `v${ready.ollama.version || "확인 중"} · 모델 ${ready.ollama.models?.length ?? 0}개${ready.ollama.recommendedInstalled ? ` · ${ready.ollama.recommendedModel || "qwen3.5:4b"} 준비됨` : " · 추천 모델 필요"}`
                    : "Ollama가 실행되지 않았습니다."}</span>
                  {!ready.ollama.recommendedInstalled && <button className="btn tiny" onClick={() => void pullRecommendedModel()}>추천 모델 받기</button>}
                </div>
                <div className={`onb-ready ${ready.codex.authenticated ? "ok" : "warn"}`}>
                  <b>{ready.codex.authenticated ? "✅" : "⚠️"} Codex 로그인</b>
                  <span>{ready.codex.detail || (ready.codex.installed ? "로그인 필요" : "CLI 없음")}</span>
                  <button className="btn tiny" onClick={() => void loginCodex()}>Codex 로그인</button>
                </div>
                <div className={`onb-ready ${ready.codex.workdir.exists && ready.codex.workdir.writable ? "ok" : "warn"}`}>
                  <b>{ready.codex.workdir.exists && ready.codex.workdir.writable ? "✅" : "⚠️"} Codex 작업 폴더</b>
                  <span title={ready.codex.workdir.dir}>{ready.codex.workdir.dir || "선택되지 않음"}</span>
                  <button className="btn tiny" onClick={() => void chooseCodexWorkdir()} disabled={busy}>코딩 폴더 선택</button>
                </div>
                <div className="onb-ready ok">
                  <b>✨ 업데이트로 추가된 기능</b>
                  <span>로컬 추론·도구 호출·구조화 출력·이미지 입력, OpenClaw 자동 시작 및 최신 설정 호환</span>
                </div>
                <div className={`onb-ready ${backup?.projects ? "ok" : "warn"}`}>
                  <b>💾 프로젝트 백업·복원</b>
                  <span>
                    {backup
                      ? `${backup.projects}개 프로젝트 · ${backup.files.toLocaleString()}개 파일 · ${(backup.bytes / 1024 / 1024).toFixed(1)}MB`
                      : "서버 PC에서 백업 상태를 확인할 수 있습니다."}
                  </span>
                  <div className="onb-ready-actions">
                    <button className="btn tiny" onClick={() => void exportProjects()} disabled={busy || !backup?.projects}>전체 백업</button>
                    <button className="btn tiny" onClick={() => backupInput.current?.click()} disabled={busy}>백업 복원</button>
                    <input
                      ref={backupInput}
                      type="file"
                      accept=".vebackup,application/vnd.vision-engine.backup"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void importProjects(file);
                      }}
                    />
                  </div>
                </div>
                {update && (
                  <div className={`onb-ready ${update.status === "error" ? "warn" : "ok"}`}>
                    <b>{update.status === "disabled" ? "ℹ️" : "✅"} Vision Engine 업데이트</b>
                    <span>현재 v{update.currentVersion} · {update.message}</span>
                    <button className="btn tiny" onClick={() => void checkDesktopUpdate()} disabled={busy || update.status === "disabled" || update.status === "downloading"}>업데이트 확인</button>
                  </div>
                )}
              </div>
            )}
            {msg && <div className="onb-msg">{msg}</div>}
            <div className="onb-actions">
              <button className="btn" onClick={() => setPath(null)} disabled={busy}>← 뒤로</button>
              <button className="btn" onClick={() => void exportSupportReport()} disabled={busy || !ready?.desktop}>진단 보고서 저장</button>
              <button className="btn" onClick={() => void refreshReadiness()} disabled={busy}>다시 확인</button>
              <button className="btn primary" onClick={finish}>확인하고 시작 →</button>
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
                RTX 4060 8GB 기준 추천 모델은 <code>qwen3.5:4b</code>입니다. 로컬 추론·도구 호출·구조화 출력과 이미지 입력을 지원합니다.
                아직 없으면 <button className="btn tiny" onClick={() => void pullRecommendedModel()}>추천 모델 받기</button>
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
