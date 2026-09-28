// PC 앱 실행 준비 진단/복구 — 비밀값은 반환하지 않고 로컬 요청만 설정을 바꾼다.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSubscriptionStatus, invalidateSubscriptionStatus } from "./subscription-agents.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = () => path.resolve(process.env.VE_REPO_ROOT || path.resolve(moduleDir, "..", ".."));
const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || repoRoot());
const openclawHome = () => path.resolve(process.env.VE_OPENCLAW_HOME || os.homedir());
const pcConfigFile = () => path.join(dataRoot(), "config", "pc-app.json");
export const RECOMMENDED_LOCAL_MODEL = "qwen3.5:4b";

const readJson = (file, fallback = {}) => {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
};

const writeJsonAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
};

const isLocalRequest = (req) => {
  const ip = String(req?.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "";
};

const checkTcp = (port, timeoutMs = 900) => new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port });
  const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
  socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
  socket.once("error", () => { clearTimeout(timer); resolve(false); });
});

function countProjects(root = dataRoot()) {
  const dir = path.join(root, "workspace", "projects");
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "project.json"))).length;
  } catch { return 0; }
}

export function openClawAgentCount(cfg) {
  if (Array.isArray(cfg?.agents?.list)) return cfg.agents.list.length;
  const entries = cfg?.agents?.entries;
  return entries && typeof entries === "object" && !Array.isArray(entries) ? Object.keys(entries).length : 0;
}

function countOpenClawAgents() {
  const cfg = readJson(path.join(openclawHome(), ".openclaw", "openclaw.json"));
  return openClawAgentCount(cfg);
}

const requestLocalJson = (pathname, timeoutMs = 1400) => new Promise((resolve) => {
  const request = http.request({ host: "127.0.0.1", port: 11434, path: pathname, method: "GET" }, (response) => {
    let body = "";
    response.setEncoding("utf-8");
    response.on("data", (chunk) => {
      if (body.length < 2_000_000) body += chunk;
    });
    response.on("end", () => {
      if ((response.statusCode ?? 500) >= 400) { resolve(null); return; }
      try { resolve(JSON.parse(body)); } catch { resolve(null); }
    });
  });
  request.setTimeout(timeoutMs, () => request.destroy());
  request.once("error", () => resolve(null));
  request.end();
});

async function ollamaStatus() {
  const version = await requestLocalJson("/api/version");
  if (!version) {
    return { running: false, version: "", models: [], runningModels: [], recommendedModel: RECOMMENDED_LOCAL_MODEL, recommendedInstalled: false };
  }
  const [tags, active] = await Promise.all([requestLocalJson("/api/tags"), requestLocalJson("/api/ps")]);
  const models = Array.isArray(tags?.models) ? tags.models.map((model) => String(model?.name || model?.model || "")).filter(Boolean) : [];
  const runningModels = Array.isArray(active?.models) ? active.models.map((model) => String(model?.name || model?.model || "")).filter(Boolean) : [];
  return {
    running: true,
    version: String(version?.version || ""),
    models,
    runningModels,
    recommendedModel: RECOMMENDED_LOCAL_MODEL,
    recommendedInstalled: models.some((model) => model === RECOMMENDED_LOCAL_MODEL || model.startsWith(`${RECOMMENDED_LOCAL_MODEL}:`)),
  };
}

function openClawInstallInfo() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "package.json"),
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "openclaw", "package.json"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "npm", "node_modules", "openclaw", "package.json"),
  ].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const pkg = readJson(file);
    return { installed: true, version: String(pkg?.version || "") };
  }
  return { installed: false, version: "" };
}

export function resolveCodexWorkdir() {
  const configured = String(readJson(pcConfigFile())?.codexWorkdir || "").trim();
  const unity = String(readJson(path.join(dataRoot(), "config", "unity.local.json"))?.dir || "").trim();
  const packagedFallback = path.join(dataRoot(), "workspace", "codex-workdir");
  const selected = process.env.VE_CODEX_WORKDIR || configured || unity || (dataRoot() === repoRoot() ? repoRoot() : packagedFallback);
  const dir = path.resolve(selected);
  if (dir === packagedFallback) fs.mkdirSync(dir, { recursive: true });
  let exists = false;
  let writable = false;
  try {
    exists = fs.statSync(dir).isDirectory();
    if (exists) { fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK); writable = true; }
  } catch { /* 진단 결과로 반환 */ }
  return { dir, exists, writable, configured: !!(process.env.VE_CODEX_WORKDIR || configured || unity) };
}

export function setCodexWorkdir(dir) {
  const raw = String(dir || "").trim();
  if (!raw) throw new Error("작업 폴더를 선택하세요.");
  const value = path.resolve(raw);
  if (!path.isAbsolute(value) || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
    throw new Error("존재하는 작업 폴더를 선택하세요.");
  }
  fs.accessSync(value, fs.constants.R_OK | fs.constants.W_OK);
  const cfg = readJson(pcConfigFile());
  cfg.codexWorkdir = value;
  cfg.updatedAt = Date.now();
  writeJsonAtomic(pcConfigFile(), cfg);
  return resolveCodexWorkdir();
}

export function resolveAiRuntime() {
  const configured = String(readJson(pcConfigFile())?.aiRuntime || "").trim();
  return configured === "openclaw" ? "openclaw" : "subscription";
}

export function setAiRuntime(mode) {
  const value = String(mode || "").trim();
  if (!new Set(["subscription", "openclaw"]).has(value)) throw new Error("지원하지 않는 AI 실행 모드입니다.");
  const cfg = readJson(pcConfigFile());
  cfg.aiRuntime = value;
  cfg.updatedAt = Date.now();
  writeJsonAtomic(pcConfigFile(), cfg);
  return value;
}

const copyMissing = (source, target) => {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
  return true;
};

/** 기존 체크아웃의 사용자 데이터만 비파괴 복사한다. 코드/템플릿은 설치본 것을 사용한다. */
export function importLegacyData(sourceRoot) {
  const source = path.resolve(String(sourceRoot || "").trim());
  const target = dataRoot();
  if (!path.isAbsolute(source) || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error("기존 Vision Engine 폴더를 찾지 못했습니다.");
  }
  if (source === target || source.startsWith(`${target}${path.sep}`) || target.startsWith(`${source}${path.sep}workspace${path.sep}`)) {
    throw new Error("원본과 새 데이터 폴더가 겹칩니다.");
  }
  const sourceData = fs.existsSync(path.join(source, "workspace")) ? source : path.join(source, "vision-engine-data");
  if (!fs.existsSync(path.join(sourceData, "workspace"))) throw new Error("선택한 폴더에 workspace가 없습니다.");
  const copied = [];
  if (copyMissing(path.join(sourceData, "workspace"), path.join(target, "workspace"))) copied.push("workspace");
  const mutableConfig = ["custom-agents.json", "agent-growth.json", "unity.local.json", "notion.json", "notion-map.json", "naver.json"];
  for (const name of mutableConfig) {
    if (copyMissing(path.join(sourceData, "config", name), path.join(target, "config", name))) copied.push(`config/${name}`);
  }
  const receipt = { source, target, copied, importedAt: Date.now(), projects: countProjects(target) };
  writeJsonAtomic(path.join(target, "migration.json"), receipt);
  return receipt;
}

export async function getReadiness({ includePaths = true } = {}) {
  const [gateway, ollama, subscriptions] = await Promise.all([checkTcp(18789), ollamaStatus(), getSubscriptionStatus()]);
  const workdir = resolveCodexWorkdir();
  const openclaw = openClawInstallInfo();
  const result = {
    ok: true,
    gateway: { running: gateway, configured: fs.existsSync(path.join(openclawHome(), ".openclaw", "openclaw.json")), agents: countOpenClawAgents(), ...openclaw },
    ollama,
    claude: subscriptions.claude,
    codex: { ...subscriptions.codex, workdir: includePaths ? workdir : { ...workdir, dir: "" } },
    aiRuntime: resolveAiRuntime(),
    data: { projects: countProjects(), migration: readJson(path.join(dataRoot(), "migration.json"), null) },
    desktop: process.env.VE_DESKTOP === "1",
    ts: Date.now(),
  };
  if (includePaths) result.data.root = dataRoot();
  return result;
}

const READINESS_CACHE_MS = 5_000;
const readinessCache = new Map();

/** 여러 화면/상태 폴링이 동시에 와도 Codex/Ollama 진단을 한 번만 실행한다. */
export async function getCachedReadiness({ includePaths = true } = {}) {
  const key = includePaths ? "local" : "remote";
  const now = Date.now();
  const cached = readinessCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = getReadiness({ includePaths })
    .then((value) => {
      readinessCache.set(key, { value, expiresAt: Date.now() + READINESS_CACHE_MS, inFlight: null });
      return value;
    })
    .catch((error) => {
      readinessCache.delete(key);
      throw error;
    });
  readinessCache.set(key, { value: cached?.value, expiresAt: 0, inFlight });
  return inFlight;
}

export function invalidateReadinessCache() {
  readinessCache.clear();
}

const readBody = async (req) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("요청이 너무 큽니다.");
  }
  return JSON.parse(body || "{}");
};

export function readinessApiPlugin() {
  return {
    name: "vision-engine-readiness-api",
    configureServer(server) {
      server.middlewares.use("/api/readiness", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (req.method === "GET") {
              res.end(JSON.stringify(await getCachedReadiness({ includePaths: isLocalRequest(req) })));
              return;
            }
            if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: "method not allowed" })); return; }
            if (!isLocalRequest(req)) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: "PC 로컬에서만 설정할 수 있습니다." })); return; }
            const body = await readBody(req);
            if (body.action === "set-codex-workdir") {
              const workdir = setCodexWorkdir(body.dir);
              invalidateReadinessCache();
              res.end(JSON.stringify({ ok: true, workdir }));
            }
            else if (body.action === "set-ai-runtime") {
              const aiRuntime = setAiRuntime(body.mode);
              invalidateReadinessCache();
              invalidateSubscriptionStatus();
              res.end(JSON.stringify({ ok: true, aiRuntime }));
            }
            else if (body.action === "import-data") {
              const migration = importLegacyData(body.source);
              invalidateReadinessCache();
              res.end(JSON.stringify({ ok: true, migration }));
            }
            else { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "지원하지 않는 준비 작업입니다." })); }
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 300) }));
          }
        })();
      });
    },
  };
}
