// MCP 허브 — config/mcp.json에 등록된 stdio MCP 서버를 spawn·연결하고
// 도구 목록·실행을 제공한다. 웹(vite 미들웨어)과 데스크톱(Electron) 양쪽에서 재사용.
// v2.1 "서버 모듈 추출"의 첫 조각 — 서버 로직을 vite.config.ts에서 분리하기 시작한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const MCP_CONFIG = path.join(REPO, "config", "mcp.json");
const UNITY_CONFIG = path.join(REPO, "config", "unity.local.json"); // 사용자별, gitignore
const PROJECTS_DIR = path.join(REPO, "workspace", "projects");

/** id → { def, status, client, transport, tools, error } */
const conns = new Map();
let started = false;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(MCP_CONFIG, "utf-8"));
  } catch {
    return { servers: [] };
  }
}

/** 등록된 유니티 프로젝트 경로 (없으면 null) */
export function readUnityDir() {
  try {
    const d = JSON.parse(fs.readFileSync(UNITY_CONFIG, "utf-8"));
    return d.dir && fs.existsSync(d.dir) ? d.dir : d.dir || null;
  } catch {
    return process.env.VE_UNITY_DIR || null;
  }
}

/** 유니티 프로젝트 경로 저장 (빈 값이면 해제) */
export function setUnityDir(dir) {
  const d = String(dir ?? "").trim();
  fs.mkdirSync(path.dirname(UNITY_CONFIG), { recursive: true });
  fs.writeFileSync(UNITY_CONFIG, JSON.stringify({ dir: d }, null, 2), "utf-8");
  return { dir: d, exists: d ? fs.existsSync(d) : false };
}

/** 유니티 프로젝트가 등록되면 자동 합성되는 파일시스템 서버 def */
function unityServerDef() {
  const dir = readUnityDir();
  if (!dir) return null;
  return {
    id: "unity-project",
    label: "유니티 프로젝트 (등록됨)",
    enabled: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", dir],
    synthesized: true,
  };
}

/** mcp.json 서버 + (등록 시) 합성 유니티 서버 */
function effectiveServers() {
  const cfg = readConfig();
  const list = [...(cfg.servers ?? [])];
  const u = unityServerDef();
  if (u && !list.some((s) => s.id === u.id)) list.push(u);
  return list;
}

/** {{KIT}}/{{REPO}}/{{UNITY}} 치환 */
function resolveArgs(args, ctx) {
  return (args ?? []).map((a) =>
    String(a)
      .replace(/\{\{KIT\}\}/g, ctx.kit)
      .replace(/\{\{REPO\}\}/g, REPO)
      .replace(/\{\{UNITY\}\}/g, ctx.unity)
  );
}

function defaultKit() {
  // 가장 최근 수정된 프로젝트의 kit 폴더 (없으면 REPO)
  try {
    const dirs = fs
      .readdirSync(PROJECTS_DIR)
      .map((d) => ({ d, m: fs.statSync(path.join(PROJECTS_DIR, d)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { d } of dirs) {
      const kit = path.join(PROJECTS_DIR, d, "kit");
      if (fs.existsSync(kit)) return kit;
    }
  } catch {
    /* noop */
  }
  return REPO;
}

async function connectOne(def, ctx) {
  const prev = conns.get(def.id);
  if (prev?.client) {
    try {
      await prev.client.close();
    } catch {
      /* noop */
    }
  }
  const rec = { def, status: "connecting", tools: [], error: null, client: null };
  conns.set(def.id, rec);
  try {
    const transport = new StdioClientTransport({
      command: def.command,
      args: resolveArgs(def.args, ctx),
      env: { ...process.env, ...(def.env ?? {}) },
      stderr: "ignore",
    });
    const client = new Client({ name: "vision-engine", version: "2.1.0" }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    rec.client = client;
    rec.transport = transport;
    rec.tools = (tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object" },
    }));
    rec.status = "ready";
  } catch (e) {
    rec.status = "error";
    rec.error = String(e?.message ?? e).slice(0, 300);
  }
  return rec;
}

/** 등록된 enabled 서버 전체 (재)연결 */
export async function startHub() {
  started = true;
  const cfg = readConfig();
  const servers = effectiveServers();
  const ctx = { kit: defaultKit(), unity: readUnityDir() || cfg.unityDir || REPO };
  const enabled = servers.filter((s) => s.enabled);
  await Promise.all(enabled.map((def) => connectOne(def, ctx)));
  // 비활성 서버도 목록엔 노출 (UI에서 상태 표시)
  for (const def of servers) {
    if (!def.enabled && !conns.has(def.id)) {
      conns.set(def.id, { def, status: "disabled", tools: [], error: null, client: null });
    }
  }
  return statusList();
}

export function statusList() {
  const servers = effectiveServers();
  const known = new Set(servers.map((s) => s.id));
  // config에서 사라진 연결은 정리
  for (const id of [...conns.keys()]) if (!known.has(id)) conns.delete(id);
  return servers.map((def) => {
    const rec = conns.get(def.id);
    return {
      id: def.id,
      label: def.label ?? def.id,
      enabled: !!def.enabled,
      status: rec?.status ?? (def.enabled ? "pending" : "disabled"),
      error: rec?.error ?? null,
      tools: rec?.tools ?? [],
    };
  });
}

/** 전체 도구 목록 (프로바이더 function-calling용) — ready 서버만 */
export function allTools() {
  const out = [];
  for (const rec of conns.values()) {
    if (rec.status !== "ready") continue;
    for (const t of rec.tools) {
      out.push({ server: rec.def.id, name: t.name, description: t.description, inputSchema: t.inputSchema });
    }
  }
  return out;
}

/** 특정 에이전트에게 허용된 서버 id 집합 (assignments 없으면 전체 허용) */
export function serversForAgent(agentId) {
  const cfg = readConfig();
  const a = cfg.assignments && cfg.assignments[agentId];
  if (!Array.isArray(a)) return null; // 전체 허용
  return new Set(a);
}

/** 에이전트별 도구 목록 — assignments에 배정된 서버의 도구만 (없으면 allTools) */
export function toolsForAgent(agentId) {
  const allow = serversForAgent(agentId);
  if (!allow) return allTools();
  return allTools().filter((t) => allow.has(t.server));
}

/** UI용 — 각 서버가 어느 에이전트에 배정됐는지 역맵 */
export function assignmentsByServer() {
  const cfg = readConfig();
  const map = {};
  for (const [agent, servers] of Object.entries(cfg.assignments ?? {})) {
    if (agent.startsWith("_") || !Array.isArray(servers)) continue;
    for (const s of servers) (map[s] ??= []).push(agent);
  }
  return map;
}

export async function callTool(server, name, args) {
  const rec = conns.get(server);
  if (!rec || rec.status !== "ready" || !rec.client) throw new Error(`MCP 서버 미연결: ${server}`);
  const res = await rec.client.callTool({ name, arguments: args ?? {} });
  // content 배열 → 텍스트로 평탄화
  const text = (res.content ?? [])
    .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
    .join("\n");
  return { isError: !!res.isError, text: text.slice(0, 20000) };
}

export async function reconnect() {
  return startHub();
}

export function isStarted() {
  return started;
}
