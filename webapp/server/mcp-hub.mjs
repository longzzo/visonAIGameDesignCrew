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

/** {{KIT}}/{{REPO}} 치환 — 현재는 프로젝트 무관 공용 kit 경로가 없으므로 REPO 기준 */
function resolveArgs(args, ctx) {
  return (args ?? []).map((a) =>
    String(a).replace(/\{\{KIT\}\}/g, ctx.kit).replace(/\{\{REPO\}\}/g, REPO)
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
  const ctx = { kit: defaultKit() };
  const enabled = (cfg.servers ?? []).filter((s) => s.enabled);
  await Promise.all(enabled.map((def) => connectOne(def, ctx)));
  // 비활성 서버도 목록엔 노출 (UI에서 상태 표시)
  for (const def of cfg.servers ?? []) {
    if (!def.enabled && !conns.has(def.id)) {
      conns.set(def.id, { def, status: "disabled", tools: [], error: null, client: null });
    }
  }
  return statusList();
}

export function statusList() {
  const cfg = readConfig();
  const known = new Set((cfg.servers ?? []).map((s) => s.id));
  // config에서 사라진 연결은 정리
  for (const id of [...conns.keys()]) if (!known.has(id)) conns.delete(id);
  return (cfg.servers ?? []).map((def) => {
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
