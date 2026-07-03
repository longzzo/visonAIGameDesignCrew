// Vision Engine — OpenClaw 에이전트 12명 자동 설정
// config/openclaw.json 템플릿을 ~/.openclaw/openclaw.json 에 적용한다.
//   - 이미 등록된 API 키·게이트웨이 토큰은 그대로 보존
//   - 기존 설정은 openclaw.json.bak-setup-<시각> 으로 백업
//   사용: node scripts/setup-openclaw.mjs   (설치 후, 게이트웨이 재시작 전에 1회)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const HOME = os.homedir();
const CFG_DIR = path.join(HOME, ".openclaw");
const CFG = path.join(CFG_DIR, "openclaw.json");
const TEMPLATE = path.join(REPO, "config", "openclaw.json");

const isPlaceholder = (s) => typeof s !== "string" || s.includes("{{") || s.includes("—") || s.length === 0;

// 1) 템플릿 로드 + 경로 치환 ({{REPO}}/{{HOME}} → 실제 경로, JSON 이스케이프 유지)
let raw = fs.readFileSync(TEMPLATE, "utf-8");
raw = raw.replaceAll("{{REPO}}", REPO.replaceAll("\\", "\\\\"));
raw = raw.replaceAll("{{HOME}}", HOME.replaceAll("\\", "\\\\"));
const next = JSON.parse(raw);

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

// 3) 백업 후 기록
fs.mkdirSync(CFG_DIR, { recursive: true });
if (fs.existsSync(CFG)) {
  const bak = `${CFG}.bak-setup-${Date.now()}`;
  fs.copyFileSync(CFG, bak);
  console.log(`🗄️ 기존 설정 백업: ${bak}`);
}
fs.writeFileSync(CFG, JSON.stringify(next, null, 2), "utf-8");

const ids = next.agents.list.map((a) => a.id).join(", ");
console.log(`✅ 에이전트 ${next.agents.list.length}명 설정 완료: ${ids}`);
console.log(`   워크스페이스: ${REPO}${path.sep}agents${path.sep}<id>`);
console.log("");
console.log("다음 단계:");
console.log('  1) 게이트웨이 재시작:  schtasks /End /TN "OpenClaw Gateway" && schtasks /Run /TN "OpenClaw Gateway"');
console.log("     (예약작업이 없다면 먼저 `openclaw onboard` 를 실행해 게이트웨이를 등록하세요)");
console.log("  2) 웹앱 실행:  VisionEngine-Start.bat 더블클릭");
