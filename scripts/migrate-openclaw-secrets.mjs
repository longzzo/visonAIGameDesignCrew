/**
 * OpenClaw 평문 자격증명을 팀 보호 저장소로 이전한다.
 * 비밀값은 파일·인수·로그에 쓰지 않고 CLI stdin으로만 전달한다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleFile = fileURLToPath(import.meta.url);

export const SECRET_SPECS = [
  {
    name: "GITHUB_MODELS_API_KEY",
    type: "models.providers.apiKey",
    path: "models.providers.github.apiKey",
    pathSegments: ["models", "providers", "github", "apiKey"],
    providerId: "github",
  },
  {
    name: "NVIDIA_API_KEY",
    type: "models.providers.apiKey",
    path: "models.providers.nvidia.apiKey",
    pathSegments: ["models", "providers", "nvidia", "apiKey"],
    providerId: "nvidia",
  },
  {
    name: "BRAVE_SEARCH_API_KEY",
    type: "plugins.entries.brave.config.webSearch.apiKey",
    path: "plugins.entries.brave.config.webSearch.apiKey",
    pathSegments: ["plugins", "entries", "brave", "config", "webSearch", "apiKey"],
  },
];

export const isSecretRef = (value) =>
  !!value && typeof value === "object" && ["env", "file", "exec", "store"].includes(value.source)
  && typeof value.provider === "string" && typeof value.id === "string";

export const migrationAuditOk = (report) => {
  if (!report || Number(report?.summary?.unresolvedRefCount || 0) > 0) return false;
  return (report.findings ?? []).every((finding) =>
    finding?.code === "PLAINTEXT_FOUND" && finding?.jsonPath === "gateway.auth.token");
};

const valueAt = (source, segments) => segments.reduce((value, segment) => value?.[segment], source);
const usablePlaintext = (value) => typeof value === "string" && value.trim().length >= 10 && !value.includes("{{");

export function buildSecretMigration(config) {
  const entries = [];
  const targets = [];
  for (const spec of SECRET_SPECS) {
    const value = valueAt(config, spec.pathSegments);
    if (!usablePlaintext(value)) continue;
    const { name, ...target } = spec;
    entries.push({ name, value: value.trim() });
    targets.push({
      ...target,
      ref: { source: "store", provider: "default", id: name },
    });
  }
  return {
    entries,
    plan: {
      version: 1,
      protocolVersion: 1,
      targets,
      options: {
        scrubEnv: true,
        scrubAuthProfilesForProviderTargets: true,
        scrubLegacyAuthJson: false,
      },
    },
  };
}

function findOpenClawEntry() {
  const home = os.homedir();
  const candidates = [
    process.env.VE_OPENCLAW_ENTRY,
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "index.js"),
    path.join(home, "AppData", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
    path.join(home, "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "npm", "node_modules", "openclaw", "dist", "index.js"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function findNodeRuntime() {
  if (/^node(?:\.exe)?$/i.test(path.basename(process.execPath))) return process.execPath;
  const candidates = [
    process.env.VE_NODE_EXECUTABLE,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs", "node.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe"),
  ].filter(Boolean);
  const direct = candidates.find((candidate) => fs.existsSync(candidate));
  if (direct) return direct;
  if (process.platform === "win32") {
    const found = spawnSync("where.exe", ["node.exe"], { encoding: "utf-8", windowsHide: true });
    if (found.status === 0) return String(found.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  }
  return "";
}

function runCli(nodeRuntime, entry, args, { input = "", timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeRuntime, [entry, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (text) => { stdout = `${stdout}${text}`.slice(-20_000); });
    child.stderr.on("data", (text) => { stderr = `${stderr}${text}`.slice(-20_000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `OpenClaw 종료 코드 ${code}`).trim().slice(0, 1_000)));
    });
    child.stdin.end(input);
  });
}

export function buildProtectionPlan(items) {
  return {
    version: 1,
    protocolVersion: 1,
    targets: items.map(({ name, value: _value, ref: _ref, ...target }) => ({
      ...target,
      ref: { source: "store", provider: "default", id: name },
    })),
    options: {
      scrubEnv: true,
      scrubAuthProfilesForProviderTargets: true,
      scrubLegacyAuthJson: false,
    },
  };
}

export async function protectOpenClawValues(items, { nodeRuntime = findNodeRuntime(), entry = findOpenClawEntry() } = {}) {
  if (!nodeRuntime || !entry) throw new Error("OpenClaw CLI 또는 Node.js를 찾지 못했습니다.");
  for (const item of items) {
    await runCli(nodeRuntime, entry, ["secrets", "store", "set", item.name, "--kind", "secret", "--value-file", "-"], {
      input: item.value,
      timeoutMs: 45_000,
    });
  }

  const plan = buildProtectionPlan(items);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-secret-plan-"));
  const planFile = path.join(tempDir, "plan.json");
  try {
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    await runCli(nodeRuntime, entry, ["secrets", "apply", "--from", planFile, "--dry-run"], { timeoutMs: 60_000 });
    await runCli(nodeRuntime, entry, ["secrets", "apply", "--from", planFile], { timeoutMs: 60_000 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function migrateOpenClawSecrets({ configFile, nodeRuntime = findNodeRuntime(), entry = findOpenClawEntry() } = {}) {
  const file = path.resolve(configFile || process.env.VE_OPENCLAW_CONFIG || process.env.OPENCLAW_CONFIG_PATH
    || path.join(os.homedir(), ".openclaw", "openclaw.json"));
  if (!fs.existsSync(file)) return { ok: true, changed: false, migrated: [], audit: null };
  if (!nodeRuntime || !entry) throw new Error("OpenClaw CLI 또는 Node.js를 찾지 못했습니다.");
  const config = JSON.parse(fs.readFileSync(file, "utf-8"));
  const migration = buildSecretMigration(config);
  if (!migration.entries.length) {
    const audit = await runCli(nodeRuntime, entry, ["secrets", "audit", "--json"], { timeoutMs: 45_000 });
    const report = JSON.parse(audit.stdout);
    return { ok: migrationAuditOk(report), changed: false, migrated: [], audit: report };
  }

  await protectOpenClawValues(migration.entries.map((item, index) => ({
    ...item,
    ...migration.plan.targets[index],
  })), { nodeRuntime, entry });

  const auditResult = await runCli(nodeRuntime, entry, ["secrets", "audit", "--json"], { timeoutMs: 45_000 });
  const audit = JSON.parse(auditResult.stdout);
  try {
    await runCli(nodeRuntime, entry, ["secrets", "reload", "--json"], { timeoutMs: 45_000 });
  } catch {
    // 데스크톱이 Gateway를 재시작/복구하므로 저장 성공을 되돌리지 않는다.
  }
  return { ok: migrationAuditOk(audit), changed: true, migrated: migration.entries.map((item) => item.name), audit };
}

if (process.env.VE_RUN_SECRET_MIGRATION === "1" || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(moduleFile))) {
  migrateOpenClawSecrets()
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        changed: result.changed,
        migrated: result.migrated,
        summary: result.audit?.summary ?? null,
      })}\n`);
      process.exitCode = result.ok ? 0 : 2;
    })
    .catch((error) => {
      process.stderr.write(`OpenClaw 비밀키 이전 실패: ${String(error?.message || error).slice(0, 1_000)}\n`);
      process.exitCode = 1;
    });
}
