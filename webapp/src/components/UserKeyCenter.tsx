import { useEffect, useState } from "react";
import { getBraveKeyStatus, setBraveKey } from "../lib/gdd";
import { getModelsInfo, registerModelKey, type ModelsInfo } from "../lib/models";

type CloudProvider = "github" | "nvidia" | "brave";

const PROVIDERS: Array<{
  id: CloudProvider;
  icon: string;
  name: string;
  badge: string;
  description: string;
  placeholder: string;
}> = [
  {
    id: "github",
    icon: "◉",
    name: "GitHub Models",
    badge: "선택 · 클라우드 AI",
    description: "GPT 계열 모델을 에이전트에 배정할 때 사용합니다. Fine-grained PAT의 Models 읽기 권한이 필요합니다.",
    placeholder: "github_pat_…",
  },
  {
    id: "nvidia",
    icon: "◆",
    name: "NVIDIA NIM",
    badge: "선택 · AI·이미지",
    description: "클라우드 추론과 지원되는 이미지 생성에 사용합니다. build.nvidia.com에서 발급받을 수 있습니다.",
    placeholder: "nvapi-…",
  },
  {
    id: "brave",
    icon: "⌕",
    name: "Brave Search",
    badge: "선택 · 웹 리서치",
    description: "에이전트가 최신 자료를 웹에서 검색할 때 사용합니다. 키가 없어도 직접 연 페이지 조회는 가능합니다.",
    placeholder: "BSA…",
  },
];

export function UserKeyCenter({ onNotice }: { onNotice?: (message: string) => void }) {
  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [brave, setBrave] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<CloudProvider | null>(null);
  const [values, setValues] = useState<Record<CloudProvider, string>>({ github: "", nvidia: "", brave: "" });
  const [notes, setNotes] = useState<Partial<Record<CloudProvider, string>>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [modelInfo, braveReady] = await Promise.all([getModelsInfo(), getBraveKeyStatus()]);
      setModels(modelInfo);
      setBrave(braveReady);
    } catch {
      setModels(null);
      setBrave(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const configured = (provider: CloudProvider) =>
    provider === "brave" ? brave : Boolean(models?.providers[provider]);

  const save = async (provider: CloudProvider) => {
    const key = values[provider].trim();
    if (key.length < 10 || saving) return;
    setSaving(provider);
    setNotes((current) => ({ ...current, [provider]: "보호 저장소에 등록하는 중…" }));
    try {
      if (provider === "brave") await setBraveKey(key);
      else await registerModelKey(provider, key);
      setValues((current) => ({ ...current, [provider]: "" }));
      setNotes((current) => ({
        ...current,
        [provider]: "✅ 등록 완료 · 입력값은 화면에서 지웠습니다.",
      }));
      onNotice?.("🔐 사용자 키를 보호 저장소에 등록했습니다. 값은 앱 화면이나 프로젝트 파일에 표시되지 않습니다.");
      await refresh();
    } catch (error: any) {
      setValues((current) => ({ ...current, [provider]: "" }));
      setNotes((current) => ({
        ...current,
        [provider]: `⚠️ ${String(error?.message || error).slice(0, 120)} · 안전을 위해 입력값을 지웠습니다.`,
      }));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <div className="onb-q">
        내 AI·검색 키 <span className="dim">키는 사용자가 직접 입력하며, 등록된 원문은 다시 보여주지 않습니다.</span>
      </div>
      <div className="onb-ready-grid">
        <div className="onb-ready ok">
          <b>🖥️ 로컬 Ollama · 키 불필요</b>
          <p className="onb-p dim">기본 권장 경로입니다. 모델과 입력 데이터가 내 PC 안에서 처리됩니다.</p>
          <span className="onb-tag ok">무료 · 오프라인 · 기본값</span>
        </div>
        {PROVIDERS.map((provider) => {
          const ready = configured(provider.id);
          const value = values[provider.id];
          return (
            <div className={`onb-ready ${ready ? "ok" : "warn"}`} key={provider.id}>
              <b>{provider.icon} {provider.name} · {loading ? "확인 중" : ready ? "등록됨" : "미등록"}</b>
              <p className="onb-p dim">{provider.description}</p>
              <span className={`onb-tag ${ready ? "ok" : ""}`}>{provider.badge}</span>
              <input
                className="onb-key"
                type="password"
                value={value}
                onChange={(event) => setValues((current) => ({ ...current, [provider.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) void save(provider.id);
                }}
                placeholder={ready ? "새 키를 입력하면 기존 키를 교체합니다" : provider.placeholder}
                aria-label={`${provider.name} API 키`}
                autoComplete="new-password"
                spellCheck={false}
              />
              <div className="onb-ready-actions">
                <button
                  className="btn tiny primary"
                  onClick={() => void save(provider.id)}
                  disabled={saving !== null || value.trim().length < 10}
                >
                  {saving === provider.id ? "보호 저장 중…" : ready ? "키 교체" : "키 등록"}
                </button>
                <span>{ready ? "등록 상태 확인됨 · 보호 여부는 시스템 보안 카드에서 확인하세요." : "기능을 쓸 때만 등록해도 됩니다."}</span>
              </div>
              {notes[provider.id] && <p className="onb-p dim">{notes[provider.id]}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}
