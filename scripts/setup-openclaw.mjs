// Vision Engine — manifest 기반 OpenClaw 에이전트 자동 설정
// config/openclaw.json 템플릿을 ~/.openclaw/openclaw.json 에 적용한다.
//   - 이미 등록된 API 키·게이트웨이 토큰은 그대로 보존
//   - 기존 설정은 openclaw.json.bak-setup-<시각> 으로 백업
//   사용: node scripts/setup-openclaw.mjs   (설치 후, 게이트웨이 재시작 전에 1회)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mergeAgentRoster, preserveUnknownConfig, readAgentRoster, writeAgentRoster } from "./openclaw-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const AGENT_REPO = process.env.VE_AGENT_REPO ? path.resolve(process.env.VE_AGENT_REPO) : REPO;
const HOME = process.env.VE_OPENCLAW_HOME ? path.resolve(process.env.VE_OPENCLAW_HOME) : os.homedir();
const CFG_DIR = path.join(HOME, ".openclaw");
const CFG = path.join(CFG_DIR, "openclaw.json");
const TEMPLATE = path.join(REPO, "config", "openclaw.json");
const MANIFEST = path.join(REPO, "config", "agents.manifest.json");
const MODEL_POLICY = path.join(REPO, "config", "model-policy.json");

const isPlaceholder = (s) => typeof s !== "string" || s.includes("{{") || s.includes("—") || s.length === 0;

// 1) 템플릿 로드 + 경로 치환 ({{REPO}}/{{HOME}} → 실제 경로, JSON 이스케이프 유지)
let raw = fs.readFileSync(TEMPLATE, "utf-8");
raw = raw.replaceAll("{{REPO}}", AGENT_REPO.replaceAll("\\", "\\\\"));
raw = raw.replaceAll("{{HOME}}", HOME.replaceAll("\\", "\\\\"));
const next = JSON.parse(raw);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
const modelPolicy = JSON.parse(fs.readFileSync(MODEL_POLICY, "utf-8"));

// 2) 기존 설정에서 보존할 것들 회수
let prev = null;
if (fs.existsSync(CFG)) {
  try {
    prev = JSON.parse(fs.readFileSync(CFG, "utf-8"));
  } catch {
    console.warn("⚠️ 기존 openclaw.json 을 해석하지 못해 새로 만듭니다 (백업은 남습니다).");
  }
}

// 게이트웨이 토큰 — 기존 것 보존, 없으면 생성
const prevToken = prev?.gateway?.auth?.token;
next.gateway.auth.token = !isPlaceholder(prevToken) ? prevToken : crypto.randomBytes(24).toString("hex");

// 프로바이더 API 키 — 기존 등록 키 보존, 없으면 빈 값(웹앱 사이드바 🔑로 나중에 등록)
for (const [name, p] of Object.entries(next.models?.providers ?? {})) {
  const prevKey = prev?.models?.providers?.[name]?.apiKey;
  if (isPlaceholder(p.apiKey)) {
    p.apiKey = !isPlaceholder(prevKey) ? prevKey : name === "ollama" ? "ollama-local" : "";
  }
}
preserveUnknownConfig(next, prev);

// 사용자 모델 선택은 보존하되, 제공 종료가 확인된 모델만 역할별 안전 기본값으로 교체한다.
const retired = (model) =>
  typeof model === "string" && modelPolicy.retiredModelPatterns.some((needle) => model.includes(needle));
const roles = new Map(manifest.agents.map((agent) => [agent.id, agent.modelRole]));
const providerReady = (model) => {
  const providerName = String(model ?? "").split("/")[0];
  const provider = next.models?.providers?.[providerName];
  if (!provider) return true;
  const key = provider.apiKey;
  return providerName === "ollama" || (!!key && !isPlaceholder(key));
};
const mergedRoster = mergeAgentRoster({
  templateAgents: readAgentRoster(next),
  previousAgents: readAgentRoster(prev),
  roles,
  modelPolicy,
  providerReady,
});
writeAgentRoster(next, mergedRoster.agents);
const previousDefault = prev?.agents?.defaults?.model?.primary;
if (previousDefault && !retired(previousDefault)) next.agents.defaults.model.primary = previousDefault;
if (retired(next.agents.defaults.model.primary)) next.agents.defaults.model.primary = modelPolicy.roles.planner;
if (!providerReady(next.agents.defaults.model.primary)) next.agents.defaults.model.primary = modelPolicy.localFallback;

// 3) 백업 후 기록
fs.mkdirSync(CFG_DIR, { recursive: true });
if (fs.existsSync(CFG)) {
  const bak = `${CFG}.bak-setup-${Date.now()}`;
  fs.copyFileSync(CFG, bak);
  console.log(`🗄️ 기존 설정 백업: ${bak}`);
}
fs.writeFileSync(CFG, JSON.stringify(next, null, 2), "utf-8");

const installedAgents = readAgentRoster(next);
const ids = installedAgents.map((a) => a.id).join(", ");
console.log(`✅ 에이전트 ${installedAgents.length}명 설정 완료: ${ids}`);
if (mergedRoster.customIds.length) {
  console.log(`🛡️ 사용자·레거시 에이전트 ${mergedRoster.customIds.length}명 보존: ${mergedRoster.customIds.join(", ")}`);
}
console.log(`   워크스페이스: ${AGENT_REPO}${path.sep}agents${path.sep}<id>`);
console.log("");
console.log("다음 단계:");
console.log("  1) 게이트웨이 재시작:  openclaw gateway restart");
console.log("     (예약작업이 없다면 먼저 `openclaw onboard` 를 실행해 게이트웨이를 등록하세요)");
console.log("  2) 웹앱 실행:  VisionEngine-Start.bat 더블클릭");
