// PC 앱 실행 준비 진단/복구 — 비밀값은 반환하지 않고 로컬 요청만 설정을 바꾼다.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = () => path.resolve(process.env.VE_REPO_ROOT || path.resolve(moduleDir, "..", ".."));
const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || repoRoot());
const openclawHome = () => path.resolve(process.env.VE_OPENCLAW_HOME || os.homedir());
const pcConfigFile = () => path.join(dataRoot(), "config", "pc-app.json");

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

function countOpenClawAgents() {
  const cfg = readJson(path.join(openclawHome(), ".openclaw", "openclaw.json"));
  return Array.isArray(cfg?.agents?.list) ? cfg.agents.list.length : 0;
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

function codexCliPath() {
  const candidates = [
    path.join(process.env.VE_WEBAPP_ROOT || path.join(repoRoot(), "webapp"), "node_modules", "@openai", "codex", "bin", "codex.js"),
    path.join(moduleDir, "..", "node_modules", "@openai", "codex", "bin", "codex.js"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || "";
}

async function codexLoginStatus() {
  const cli = codexCliPath();
  if (!cli) return { installed: false, authenticated: false, detail: "Codex CLI를 찾지 못했습니다." };
  return await new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [cli, "login", "status"], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || "1" },
    });
    const timer = setTimeout(() => child.kill(), 4000);
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timer); resolve({ installed: true, authenticated: false, detail: error.message.slice(0, 160) }); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const clean = output.replace(/[\r\n]+/g, " ").trim();
      const authenticated = code === 0;
      const detail = authenticated ? "로그인됨" : /not logged|login required|로그인 필요/i.test(clean) ? "로그인 필요" : "로그인 상태를 확인하지 못했습니다.";
      resolve({ installed: true, authenticated, detail });
    });
  });
}

export async function getReadiness({ includePaths = true } = {}) {
  const [gateway, ollama, codex] = await Promise.all([checkTcp(18789), checkTcp(11434), codexLoginStatus()]);
  const workdir = resolveCodexWorkdir();
  const result = {
    ok: true,
    gateway: { running: gateway, configured: fs.existsSync(path.join(openclawHome(), ".openclaw", "openclaw.json")), agents: countOpenClawAgents() },
    ollama: { running: ollama },
    codex: { ...codex, workdir: includePaths ? workdir : { ...workdir, dir: "" } },
    data: { projects: countProjects(), migration: readJson(path.join(dataRoot(), "migration.json"), null) },
    desktop: process.env.VE_DESKTOP === "1",
    ts: Date.now(),
  };
  if (includePaths) result.data.root = dataRoot();
  return result;
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
              res.end(JSON.stringify(await getReadiness({ includePaths: isLocalRequest(req) })));
              return;
            }
            if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: "method not allowed" })); return; }
            if (!isLocalRequest(req)) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: "PC 로컬에서만 설정할 수 있습니다." })); return; }
            const body = await readBody(req);
            if (body.action === "set-codex-workdir") res.end(JSON.stringify({ ok: true, workdir: setCodexWorkdir(body.dir) }));
            else if (body.action === "import-data") res.end(JSON.stringify({ ok: true, migration: importLegacyData(body.source) }));
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
