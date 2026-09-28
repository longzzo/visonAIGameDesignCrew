// 실제 비밀 저장소나 사용자 설정을 쓰지 않는 OpenClaw SecretRef 계획 smoke.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSecretMigration } from "./migrate-openclaw-secrets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = [
  process.env.VE_OPENCLAW_ENTRY,
  process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!entry) throw new Error("OpenClaw CLI를 찾지 못했습니다.");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-openclaw-secret-smoke-"));
const configFile = path.join(temp, "openclaw.json");
const planFile = path.join(temp, "plan.json");
try {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config", "openclaw.json"), "utf-8")
    .replaceAll("{{REPO}}", temp.replaceAll("\\", "\\\\"))
    .replaceAll("{{HOME}}", temp.replaceAll("\\", "\\\\")));
  config.gateway.auth.token = "fake-gateway-token-for-read-only-smoke";
  config.models.providers.github.apiKey = "fake-github-key-for-read-only-smoke";
  config.models.providers.nvidia.apiKey = "fake-nvidia-key-for-read-only-smoke";
  for (const id of Object.keys(config.agents?.entries ?? {})) {
    fs.mkdirSync(path.join(temp, "agents", id, "agent"), { recursive: true });
  }

  const before = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(configFile, before, "utf-8");
  const migration = buildSecretMigration(config);
  if (migration.entries.length !== 2) throw new Error("모델 공급자 보호 계획 수가 예상과 다릅니다.");
  for (const item of migration.entries) {
    if (JSON.stringify(migration.plan).includes(item.value)) throw new Error("보호 계획에 비밀값이 포함됐습니다.");
  }

  // store 쓰기/실제 apply 없이 공식 OpenClaw 경로 검증만 수행한다.
  const validationPlan = {
    ...migration.plan,
    targets: migration.plan.targets.map((target) => ({
      ...target,
      ref: { source: "env", provider: "default", id: target.ref.id },
    })),
  };
  fs.writeFileSync(planFile, `${JSON.stringify(validationPlan, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  const checked = spawnSync(process.execPath, [entry, "secrets", "apply", "--from", planFile, "--dry-run"], {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 60_000,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: temp,
      OPENCLAW_CONFIG_PATH: configFile,
      GITHUB_MODELS_API_KEY: "fake-github-key-for-read-only-smoke",
      NVIDIA_API_KEY: "fake-nvidia-key-for-read-only-smoke",
    },
  });
  if (checked.status !== 0) throw new Error(String(checked.stderr || checked.stdout || "SecretRef 계획 dry-run 실패").trim());
  if (fs.readFileSync(configFile, "utf-8") !== before) throw new Error("dry-run이 격리 설정을 변경했습니다.");
  console.log("✅ OpenClaw 비밀키 계획 smoke 통과: 비밀값 미포함, 모델 경로 2건, 설정 변경 0건");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
