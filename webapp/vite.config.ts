import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../workspace");
const PROJECTS_DIR = path.join(WORKSPACE, "projects");
const LEGACY_GDD = path.join(WORKSPACE, "GDD.md");

/* ── 프로젝트 저장소 헬퍼 ─────────────────────────────── */

function gddTemplate(name: string): string {
  return [
    `# 마스터 GDD — ${name}`,
    "",
    "> Vision Engine이 관리하는 마스터 게임 디자인 문서. PM 디렉터가 각 전문 에이전트의 산출물을 이 문서에 통합한다.",
    "",
    "## 1. 개요",
    "_(PM 디렉터 담당 — 아직 작성되지 않음)_",
    "",
    "## 2. 세계관·스토리",
    "_(시나리오 라이터 담당 — 아직 작성되지 않음)_",
    "",
    "## 3. 게임플레이",
    "_(게임플레이 디자이너 담당 — 아직 작성되지 않음)_",
    "",
    "## 4. 시스템",
    "_(시스템 디자이너 담당 — 아직 작성되지 않음)_",
    "",
    "## 5. UI/UX",
    "_(UI/UX 디자이너 담당 — 아직 작성되지 않음)_",
    "",
    "## 6. 밸런스",
    "_(밸런스 디자이너 담당 — 아직 작성되지 않음)_",
    "",
    "## 7. 수익모델",
    "_(BM 전략가 담당 — 아직 작성되지 않음)_",
    "",
    "## 8. 아트",
    "_(아트 디렉터 담당 — 아직 작성되지 않음)_",
    "",
    "## 9. 기술",
    "_(테크니컬 디렉터 담당 — 아직 작성되지 않음)_",
    "",
    "## 10. 일정",
    "_(스케줄러 담당 — 아직 작성되지 않음)_",
    "",
    "## 11. 마케팅",
    "_(마케팅 담당관 담당 — 아직 작성되지 않음)_",
    "",
  ].join("\n");
}

/** 경로 탈출 방지 — 프로젝트 id는 소문자·숫자·하이픈만 */
function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(id);
}

function projectDir(id: string): string {
  return path.join(PROJECTS_DIR, id);
}

/** projects/ 준비 + 구버전 단일 GDD.md 자동 마이그레이션 */
function ensureProjects(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const has = fs
    .readdirSync(PROJECTS_DIR)
    .some((d) => fs.existsSync(path.join(PROJECTS_DIR, d, "project.json")));
  if (!has && fs.existsSync(LEGACY_GDD)) {
    const dir = projectDir("default");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(LEGACY_GDD, path.join(dir, "GDD.md"));
    fs.writeFileSync(
      path.join(dir, "project.json"),
      JSON.stringify({ name: "첫 테스트 (달빛 고양이 기사단)", createdAt: Date.now() }, null, 2),
      "utf-8"
    );
    console.log("[projects] 기존 workspace/GDD.md → projects/default/ 마이그레이션 완료");
  }
}

function listProjects(): { id: string; name: string; createdAt: number; mtime: number }[] {
  ensureProjects();
  const out: { id: string; name: string; createdAt: number; mtime: number }[] = [];
  for (const id of fs.readdirSync(PROJECTS_DIR)) {
    const metaPath = path.join(PROJECTS_DIR, id, "project.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const gddPath = path.join(PROJECTS_DIR, id, "GDD.md");
      const mtime = fs.existsSync(gddPath) ? fs.statSync(gddPath).mtimeMs : 0;
      out.push({ id, name: meta.name ?? id, createdAt: meta.createdAt ?? 0, mtime });
    } catch {
      /* 손상된 메타는 건너뜀 */
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

function gddPathOf(projectId: string | null): string {
  if (projectId && isSafeId(projectId) && fs.existsSync(projectDir(projectId))) {
    return path.join(projectDir(projectId), "GDD.md");
  }
  return LEGACY_GDD; // 하위 호환
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c: any) => (body += c));
    req.on("end", () => resolve(body));
  });
}

/**
 * 원격 읽기전용 모드 — VE_REMOTE_MODE=readonly 로 실행하면 tailnet(폰) 기기는
 * 조회만 가능하고 실행·수정·삭제는 전부 403. 폰 분실 시 피해를 열람으로 제한한다.
 * 기본값은 기존과 동일한 "full"(원격 실행 허용).
 */
const REMOTE_READONLY = (process.env.VE_REMOTE_MODE ?? "full").toLowerCase() === "readonly";

function blockRemoteWrite(req: any, res: any): boolean {
  if (!REMOTE_READONLY || isLocalReq(req)) return false;
  res.statusCode = 403;
  res.end(JSON.stringify({ ok: false, error: "원격 읽기전용 모드입니다 — 이 작업은 PC에서만 가능합니다 (VE_REMOTE_MODE=readonly)" }));
  return true;
}

/**
 * 소프트 삭제 — 즉시 지우지 않고 같은 위치의 .trash/ 폴더로 옮긴다.
 * 실수 삭제 시 파일 탐색기에서 꺼내오면 복구된다. (UI 복원은 추후)
 */
function trashFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const dir = path.join(path.dirname(file), ".trash");
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(file, path.join(dir, `${Date.now()}-${path.basename(file)}`));
}

/* ── 옵시디안 연동 헬퍼 (볼트 = 지식 원천 + 산출물 아카이브) ── */

/** 볼트에서 학습 후보로 인식하는 태그 (본문 #ve-학습 또는 frontmatter tags) */
const OBSIDIAN_LEARN_TAG = "ve-학습";
/** 산출물이 저장되는 볼트 내 폴더 — 학습 후보 스캔에서는 제외된다 */
const OBSIDIAN_EXPORT_DIR = "VisionEngine";

const AGENT_NAMES_KO: Record<string, string> = {
  pm: "PM 디렉터", scenario: "시나리오 라이터", gameplay: "게임플레이 디자이너",
  systems: "시스템 디자이너", uiux: "UIUX 디자이너", balance: "밸런스 디자이너",
  bm: "BM 전략가", visual: "아트 디렉터", td: "테크니컬 디렉터",
  scheduler: "스케줄러", marketing: "마케팅 담당관",
};

/**
 * 볼트 위치 결정: VE_VAULT_DIR 환경변수 → 옵시디안 앱에 등록된 볼트(최근 열람)
 * → 기본 생성 위치 D:\ObsidianVault. 요청마다 재평가하므로 나중에 옵시디안에서
 * 다른 볼트를 열면 자동으로 따라간다.
 */
function resolveVault(): string | null {
  const env = process.env.VE_VAULT_DIR;
  if (env && fs.existsSync(env)) return env;
  try {
    const cfg = path.join(process.env.APPDATA ?? "", "obsidian", "obsidian.json");
    if (fs.existsSync(cfg)) {
      const vaults = Object.values(JSON.parse(fs.readFileSync(cfg, "utf-8"))?.vaults ?? {}) as any[];
      vaults.sort((a, b) => (b?.ts ?? 0) - (a?.ts ?? 0));
      for (const v of vaults) if (v?.path && fs.existsSync(v.path)) return v.path;
    }
  } catch {
    /* 설정 파싱 실패 시 기본 경로로 */
  }
  const fallback = "D:\\ObsidianVault";
  return fs.existsSync(fallback) ? fallback : null;
}

/** frontmatter의 tags/agents만 관심 있는 경량 파서 (인라인·블록 리스트 지원) */
function parseFrontmatter(md: string): { body: string; tags: string[]; agents: string[] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md, tags: [], agents: [] };
  const fm = m[1];
  const list = (key: string): string[] => {
    const inline = new RegExp(`^${key}\\s*:\\s*\\[?([^\\n\\]]*)\\]?\\s*$`, "mi").exec(fm);
    if (inline && inline[1].trim())
      return inline[1].split(",").map((s) => s.trim().replace(/^["'#]+|["']+$/g, "")).filter(Boolean);
    const block = new RegExp(`^${key}\\s*:\\s*\\r?\\n((?:[ \\t]+-[ \\t]+.*\\r?\\n?)+)`, "mi").exec(fm);
    if (block)
      return block[1].split(/\r?\n/).map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim().replace(/^["'#]+|["']+$/g, "")).filter(Boolean);
    return [];
  };
  return { body: md.slice(m[0].length), tags: list("tags"), agents: list("agents") };
}

/** 위키링크를 일반 텍스트로 — 에이전트 프롬프트에 [[...]]가 들어가면 혼란을 준다 */
function stripWikiLinks(md: string): string {
  return md
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");
}

function hasLearnTag(md: string): boolean {
  if (md.includes(`#${OBSIDIAN_LEARN_TAG}`)) return true;
  return parseFrontmatter(md).tags.some((t) => t === OBSIDIAN_LEARN_TAG);
}

/**
 * 내부망 주소 제거 — 외부에서 온 문서/노트가 에이전트에게 내부 API(게이트웨이 등)
 * 조회를 유도하는 것(SSRF류 프롬프트 인젝션)을 차단한다.
 */
function stripInternalUrls(s: string): string {
  return s.replace(
    /https?:\/\/(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|0\.0\.0\.0|\[?::1\]?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?[^\s)"'\]]*/gi,
    "[내부 주소 제거됨]"
  );
}

/** 볼트의 .md 파일 순회 — .obsidian/휴지통/산출물 폴더는 건너뛴다 */
function walkVaultMd(root: string): string[] {
  const skip = new Set([".obsidian", ".trash", ".git", "node_modules", OBSIDIAN_EXPORT_DIR]);
  const out: string[] = [];
  const stack = [root];
  let guard = 0;
  while (stack.length && guard++ < 4000) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
    }
  }
  return out;
}

function sanitizeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "무제";
}

/**
 * 산출물 자동 아카이브 — GDD·보고서(회의록·협업 결론 포함)를 볼트에 마크다운으로.
 * 실패해도 원래 저장 흐름을 막지 않는다 (best-effort).
 */
function exportToVault(projectId: string, kind: "gdd" | "report", data: { agent?: string; title?: string; markdown: string }) {
  try {
    const vault = resolveVault();
    if (!vault || !projectId || !isSafeId(projectId)) return;
    const pname = sanitizeFileName(listProjects().find((p) => p.id === projectId)?.name ?? projectId);
    const base = path.join(vault, OBSIDIAN_EXPORT_DIR, pname);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    if (kind === "gdd") {
      fs.mkdirSync(base, { recursive: true });
      const fm = `---\nsource: vision-engine\ntype: GDD\nproject: "${pname}"\nupdated: ${now.toISOString()}\ntags: [vision-engine]\n---\n\n> ⚠️ Vision Engine이 내보낸 **사본**입니다 — 여기서 수정해도 앱에 반영되지 않습니다. 수정은 앱의 GDD 패널에서 하세요.\n\n`;
      fs.writeFileSync(path.join(base, "GDD.md"), fm + data.markdown, "utf-8");
    } else {
      const dir = path.join(base, "보고서");
      fs.mkdirSync(dir, { recursive: true });
      const agentName = AGENT_NAMES_KO[data.agent ?? ""] ?? data.agent ?? "";
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
      const fname = sanitizeFileName(`${stamp} ${agentName} — ${data.title ?? "보고서"}`) + ".md";
      const fm = `---\nsource: vision-engine\ntype: 보고서\nproject: "${pname}"\nagent: "${agentName}"\ntitle: "${(data.title ?? "").replace(/"/g, "'")}"\ncreated: ${now.toISOString()}\ntags: [vision-engine]\n---\n\n`;
      fs.writeFileSync(path.join(dir, fname), fm + data.markdown, "utf-8");
    }
  } catch (e) {
    console.warn("[obsidian] 볼트 내보내기 실패:", e);
  }
}

/* ── 플러그인: 프로젝트 CRUD ──────────────────────────── */

function projectsApiPlugin(): Plugin {
  return {
    name: "vision-engine-projects-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/projects", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            if (req.method === "GET") {
              res.end(JSON.stringify({ projects: listProjects() }));
              return;
            }
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const name = String(j.name ?? "").trim();
              if (!name) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "name 필요" }));
                return;
              }
              if (j.id) {
                // 이름 변경
                const id = String(j.id);
                if (!isSafeId(id) || !fs.existsSync(projectDir(id))) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ ok: false, error: "프로젝트 없음" }));
                  return;
                }
                const metaPath = path.join(projectDir(id), "project.json");
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                meta.name = name;
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
                res.end(JSON.stringify({ ok: true, id }));
                return;
              }
              // 새 프로젝트
              ensureProjects();
              const id = "p" + Date.now().toString(36);
              fs.mkdirSync(projectDir(id), { recursive: true });
              fs.writeFileSync(
                path.join(projectDir(id), "project.json"),
                JSON.stringify({ name, createdAt: Date.now() }, null, 2),
                "utf-8"
              );
              fs.writeFileSync(path.join(projectDir(id), "GDD.md"), gddTemplate(name), "utf-8");
              res.end(JSON.stringify({ ok: true, id }));
              return;
            }
            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              const id = url.searchParams.get("id") ?? "";
              if (!isSafeId(id) || !fs.existsSync(projectDir(id))) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "프로젝트 없음" }));
                return;
              }
              // 소프트 삭제 — workspace/.trash/ 로 이동 (실수 삭제 복구 가능)
              const trashDir = path.join(WORKSPACE, ".trash");
              fs.mkdirSync(trashDir, { recursive: true });
              fs.renameSync(projectDir(id), path.join(trashDir, `${id}-${Date.now()}`));
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 마스터 GDD 읽기/쓰기 + 버전 히스토리 (프로젝트별) ── */

function historyDirOf(projectId: string): string {
  return path.join(projectDir(projectId), "history");
}

/** 저장 직전 현재 GDD를 스냅샷으로 남긴다 (동일 내용이면 생략, 최근 50개 유지) */
function snapshotGdd(projectId: string | null, incoming: string): void {
  if (!projectId || !isSafeId(projectId) || !fs.existsSync(projectDir(projectId))) return;
  const gddPath = gddPathOf(projectId);
  if (!fs.existsSync(gddPath)) return;
  const current = fs.readFileSync(gddPath, "utf-8");
  if (current === incoming) return;
  const dir = historyDirOf(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}.md`), current, "utf-8");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => Number(b.replace(".md", "")) - Number(a.replace(".md", "")));
  for (const f of files.slice(50)) fs.rmSync(path.join(dir, f), { force: true });
}

function gddApiPlugin(): Plugin {
  return {
    name: "vision-engine-gdd-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/gdd", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, ""); // "", "/history", "/restore"
            const project = url.searchParams.get("project");
            const GDD_PATH = gddPathOf(project);

            // 버전 목록 / 특정 버전 내용
            if (sub === "/history" && req.method === "GET") {
              const ts = url.searchParams.get("ts");
              const dir = project && isSafeId(project) ? historyDirOf(project) : "";
              if (!dir || !fs.existsSync(dir)) {
                res.end(JSON.stringify(ts ? { markdown: "" } : { versions: [] }));
                return;
              }
              if (ts) {
                const f = path.join(dir, `${Number(ts)}.md`);
                res.end(JSON.stringify({ markdown: fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : "" }));
                return;
              }
              const versions = fs
                .readdirSync(dir)
                .filter((f) => /^\d+\.md$/.test(f))
                .map((f) => ({ ts: Number(f.replace(".md", "")), size: fs.statSync(path.join(dir, f)).size }))
                .sort((a, b) => b.ts - a.ts);
              res.end(JSON.stringify({ versions }));
              return;
            }

            // 과거 버전으로 복원 (복원 직전 현재본도 스냅샷됨)
            if (sub === "/restore" && req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const { ts } = JSON.parse((await readBody(req)) || "{}");
              const dir = project && isSafeId(project) ? historyDirOf(project) : "";
              const f = dir ? path.join(dir, `${Number(ts)}.md`) : "";
              if (!f || !fs.existsSync(f)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "해당 버전 없음" }));
                return;
              }
              const old = fs.readFileSync(f, "utf-8");
              snapshotGdd(project, old);
              fs.writeFileSync(GDD_PATH, old, "utf-8");
              if (project) exportToVault(project, "gdd", { markdown: old });
              res.end(JSON.stringify({ ok: true, markdown: old, mtime: fs.statSync(GDD_PATH).mtimeMs }));
              return;
            }

            if (req.method === "GET") {
              const markdown = fs.existsSync(GDD_PATH)
                ? fs.readFileSync(GDD_PATH, "utf-8")
                : "# 마스터 GDD\n\n_(아직 없음)_\n";
              const mtime = fs.existsSync(GDD_PATH) ? fs.statSync(GDD_PATH).mtimeMs : 0;
              res.end(JSON.stringify({ markdown, mtime }));
              return;
            }
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const { markdown } = JSON.parse((await readBody(req)) || "{}");
              if (typeof markdown !== "string") {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "markdown 필드 필요" }));
                return;
              }
              snapshotGdd(project, markdown);
              fs.mkdirSync(path.dirname(GDD_PATH), { recursive: true });
              fs.writeFileSync(GDD_PATH, markdown, "utf-8");
              if (project) exportToVault(project, "gdd", { markdown });
              res.end(JSON.stringify({ ok: true, mtime: fs.statSync(GDD_PATH).mtimeMs }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 채팅/피드 히스토리 영속화 (프로젝트별) ──── */

function chatsApiPlugin(): Plugin {
  const safeAgent = (s: string) => /^[a-z0-9-]{1,30}$/.test(s);
  return {
    name: "vision-engine-chats-api",
    configureServer(server: ViteDevServer) {
      // 에이전트별 채팅: projects/<id>/chats/<agent>.json
      server.middlewares.use("/api/chats", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const project = url.searchParams.get("project") ?? "";
            const agent = url.searchParams.get("agent") ?? "";
            if (!isSafeId(project) || !safeAgent(agent) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "project/agent 확인 필요" }));
              return;
            }
            const file = path.join(projectDir(project), "chats", `${agent}.json`);
            if (req.method === "GET") {
              const messages = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")).messages ?? [] : [];
              res.end(JSON.stringify({ messages }));
              return;
            }
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const { messages } = JSON.parse((await readBody(req)) || "{}");
              if (!Array.isArray(messages)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "messages 배열 필요" }));
                return;
              }
              fs.mkdirSync(path.dirname(file), { recursive: true });
              fs.writeFileSync(file, JSON.stringify({ messages: messages.slice(-200) }, null, 0), "utf-8");
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
      // 오케스트레이션 대화 피드: projects/<id>/feed.json
      server.middlewares.use("/api/feed", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const file = path.join(projectDir(project), "feed.json");
            if (req.method === "GET") {
              const feed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")).feed ?? [] : [];
              res.end(JSON.stringify({ feed }));
              return;
            }
            if (req.method === "POST") {
              const { feed } = JSON.parse((await readBody(req)) || "{}");
              if (!Array.isArray(feed)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "feed 배열 필요" }));
                return;
              }
              fs.writeFileSync(file, JSON.stringify({ feed: feed.slice(-400) }, null, 0), "utf-8");
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── OpenClaw 설정 공용 헬퍼 ──────────────────────────── */

const OPENCLAW_CFG = path.join(os.homedir(), ".openclaw", "openclaw.json");

/**
 * 보안: 설정을 바꾸는 API(모델 전환·키 등록)는 PC 로컬 요청만 허용.
 * tailnet 노출 모드에서 폰은 조회·실행은 가능하지만 시스템 설정은 못 바꾼다.
 */
function isLocalReq(req: any): boolean {
  const a = String(req?.socket?.remoteAddress ?? "");
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/** 예약작업으로 게이트웨이 재시작 — 설정 변경(키/모델) 반영용 */
function restartGateway(): void {
  spawn("schtasks", ["/End", "/TN", "OpenClaw Gateway"], { shell: false, windowsHide: true }).on("close", () => {
    setTimeout(() => {
      spawn("schtasks", ["/Run", "/TN", "OpenClaw Gateway"], { shell: false, windowsHide: true });
    }, 1500);
  });
}

/* ── 플러그인: Brave 검색 키 등록 (웹앱에서 붙여넣기) ──── */

function braveKeyPlugin(): Plugin {
  const cfgPath = OPENCLAW_CFG;
  return {
    name: "vision-engine-brave-key",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/brave-key", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (req.method === "GET") {
              const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
              const key = cfg?.tools?.web?.search?.apiKey ?? "";
              res.end(JSON.stringify({ configured: typeof key === "string" && key.length > 10 }));
              return;
            }
            if (req.method === "POST") {
              if (!isLocalReq(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "보안: 키 등록은 PC(로컬)에서만 가능합니다" }));
                return;
              }
              const { key } = JSON.parse((await readBody(req)) || "{}");
              if (typeof key !== "string" || key.trim().length < 10) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "키가 너무 짧습니다" }));
                return;
              }
              const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
              cfg.tools = cfg.tools || {};
              cfg.tools.web = cfg.tools.web || {};
              // provider를 명시하지 않으면 게이트웨이가 다른 검색 프로바이더(MiniMax 등)로 기본 설정될 수 있다
              cfg.tools.web.search = { ...(cfg.tools.web.search || {}), enabled: true, provider: "brave", apiKey: key.trim() };
              fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf-8");
              restartGateway(); // 키 반영
              res.end(JSON.stringify({ ok: true }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 보고서 저장소 (프로젝트별 정식 명세서/보고서) ── */

function reportsApiPlugin(): Plugin {
  const safeAgent = (s: string) => /^[a-z0-9-]{1,30}$/.test(s);
  const reportsDir = (projectId: string) => path.join(projectDir(projectId), "reports");
  return {
    name: "vision-engine-reports-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/reports", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const dir = reportsDir(project);

            if (req.method === "GET") {
              const ts = url.searchParams.get("ts");
              if (ts) {
                // 단건 조회
                const f = path.join(dir, `${Number(ts)}.json`);
                if (!fs.existsSync(f)) {
                  res.statusCode = 404;
                  res.end(JSON.stringify({ ok: false, error: "보고서 없음" }));
                  return;
                }
                res.end(fs.readFileSync(f, "utf-8"));
                return;
              }
              // 목록 (본문 제외 메타만)
              if (!fs.existsSync(dir)) {
                res.end(JSON.stringify({ reports: [] }));
                return;
              }
              const reports = fs
                .readdirSync(dir)
                .filter((f) => /^\d+\.json$/.test(f))
                .map((f) => {
                  try {
                    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
                    return { ts: j.ts, agent: j.agent, title: j.title, size: (j.markdown ?? "").length };
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean)
                .sort((a: any, b: any) => b.ts - a.ts);
              res.end(JSON.stringify({ reports }));
              return;
            }

            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const agent = String(j.agent ?? "");
              const title = String(j.title ?? "").trim().slice(0, 120);
              const markdown = String(j.markdown ?? "");
              if (!safeAgent(agent) || !title || !markdown) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "agent/title/markdown 필요" }));
                return;
              }
              fs.mkdirSync(dir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(
                path.join(dir, `${ts}.json`),
                JSON.stringify({ ts, agent, title, markdown }, null, 0),
                "utf-8"
              );
              exportToVault(project, "report", { agent, title, markdown });
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              const ts = Number(url.searchParams.get("ts") ?? 0);
              const f = path.join(dir, `${ts}.json`);
              if (!fs.existsSync(f)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "보고서 없음" }));
                return;
              }
              trashFile(f);
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 지식 라이브러리 (스튜디오 공용, 프로젝트 무관) ── */

function knowledgeApiPlugin(): Plugin {
  const dir = path.join(WORKSPACE, "knowledge");
  return {
    name: "vision-engine-knowledge-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/knowledge", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");

            if (req.method === "GET") {
              if (!fs.existsSync(dir)) {
                res.end(JSON.stringify({ items: [] }));
                return;
              }
              const items = fs
                .readdirSync(dir)
                .filter((f) => /^\d+\.json$/.test(f))
                .map((f) => {
                  try {
                    return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean)
                .sort((a: any, b: any) => b.ts - a.ts);
              res.end(JSON.stringify({ items }));
              return;
            }

            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const title = String(j.title ?? "").trim().slice(0, 120);
              const summary = String(j.summary ?? "").trim();
              const content = String(j.content ?? "");
              const agents = Array.isArray(j.agents) ? j.agents.map(String) : ["all"];
              const source = typeof j.source === "string" ? j.source.slice(0, 300) : undefined;
              const srcMtime = Number(j.srcMtime) || undefined;
              if (!title || !summary) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "title/summary 필요" }));
                return;
              }
              fs.mkdirSync(dir, { recursive: true });
              // 같은 출처(옵시디안 노트)를 다시 학습하면 이전 버전을 대체한다
              if (source) {
                for (const f of fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
                  try {
                    if (JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")).source === source)
                      fs.rmSync(path.join(dir, f), { force: true });
                  } catch {
                    /* 손상 파일 무시 */
                  }
                }
              }
              const ts = Date.now();
              fs.writeFileSync(
                path.join(dir, `${ts}.json`),
                JSON.stringify(
                  { ts, title, summary, content: content.slice(0, 30000), agents, ...(source ? { source, srcMtime } : {}) },
                  null,
                  0
                ),
                "utf-8"
              );
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              const ts = Number(url.searchParams.get("ts") ?? 0);
              trashFile(path.join(dir, `${ts}.json`));
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 옵시디안 볼트 (학습 후보 조회 + 노트 읽기) ── */

/**
 * GET /status        → 볼트 연결 상태·경로·산출물 폴더
 * GET /learn         → #ve-학습 태그가 달린 노트 목록 (지식 라이브러리와 대조해 new/updated/learned)
 * GET /note?path=... → 노트 내용 (태그 재확인 후에만 — 임의 볼트 파일 열람 방지)
 * 쓰기 엔드포인트는 없다 — 볼트 쓰기는 서버 내부 훅(exportToVault)만 수행.
 */
function obsidianApiPlugin(): Plugin {
  const knowledgeDir = path.join(WORKSPACE, "knowledge");
  return {
    name: "vision-engine-obsidian-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/obsidian", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, "");
            const vault = resolveVault();

            if (sub === "/status" && req.method === "GET") {
              res.end(
                JSON.stringify({
                  connected: !!vault,
                  vault,
                  exportDir: vault ? path.join(vault, OBSIDIAN_EXPORT_DIR) : null,
                  learnTag: OBSIDIAN_LEARN_TAG,
                })
              );
              return;
            }
            if (!vault) {
              res.statusCode = 404;
              res.end(JSON.stringify({ ok: false, error: "옵시디안 볼트를 찾지 못했습니다" }));
              return;
            }

            if (sub === "/learn" && req.method === "GET") {
              // 학습된 지식의 출처 맵 (source → srcMtime)
              const learned = new Map<string, number>();
              if (fs.existsSync(knowledgeDir)) {
                for (const f of fs.readdirSync(knowledgeDir).filter((f) => /^\d+\.json$/.test(f))) {
                  try {
                    const k = JSON.parse(fs.readFileSync(path.join(knowledgeDir, f), "utf-8"));
                    if (typeof k.source === "string") learned.set(k.source, Number(k.srcMtime) || 0);
                  } catch {
                    /* 무시 */
                  }
                }
              }
              const notes: any[] = [];
              for (const file of walkVaultMd(vault)) {
                let stat: fs.Stats;
                try {
                  stat = fs.statSync(file);
                } catch {
                  continue;
                }
                if (stat.size > 300_000) continue; // 지나치게 큰 노트는 제외
                let md: string;
                try {
                  md = fs.readFileSync(file, "utf-8");
                } catch {
                  continue;
                }
                if (!hasLearnTag(md)) continue;
                const rel = path.relative(vault, file).replace(/\\/g, "/");
                const src = `obsidian:${rel}`;
                const state = !learned.has(src)
                  ? "new"
                  : Math.floor(stat.mtimeMs) > (learned.get(src) ?? 0)
                    ? "updated"
                    : "learned";
                notes.push({
                  path: rel,
                  title: path.basename(file, ".md"),
                  mtime: Math.floor(stat.mtimeMs),
                  state,
                });
                if (notes.length >= 100) break;
              }
              notes.sort((a, b) => b.mtime - a.mtime);
              res.end(JSON.stringify({ notes }));
              return;
            }

            if (sub === "/note" && req.method === "GET") {
              const rel = url.searchParams.get("path") ?? "";
              const abs = path.resolve(vault, rel);
              // 경로 탈출·절대경로 차단 + 볼트 내부 확인
              if (!rel || path.isAbsolute(rel) || !abs.startsWith(path.resolve(vault) + path.sep) || !abs.endsWith(".md")) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "path 확인 필요" }));
                return;
              }
              if (!fs.existsSync(abs)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "노트 없음" }));
                return;
              }
              const md = fs.readFileSync(abs, "utf-8");
              // 태그가 달린 노트만 서빙 — path 파라미터로 임의 노트를 여는 것을 막는다
              if (!hasLearnTag(md)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: `#${OBSIDIAN_LEARN_TAG} 태그가 없는 노트입니다` }));
                return;
              }
              const { body, agents } = parseFrontmatter(md);
              res.end(
                JSON.stringify({
                  title: path.basename(abs, ".md"),
                  content: stripInternalUrls(stripWikiLinks(body)).slice(0, 30000),
                  agents,
                  mtime: Math.floor(fs.statSync(abs).mtimeMs),
                })
              );
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 시스템 헬스 (신호등) ─────────────────── */

/**
 * GET  /api/health → 각 구성요소(게이트웨이/Ollama/SD/볼트) 생존 여부
 * POST /api/health {restart:"gateway"} → 게이트웨이 재시작 (PC 로컬 전용)
 * Vite 자신이 죽으면 이 API도 안 뜨므로 "응답 없음 = 웹 서버가 죽음"이다.
 */
function healthApiPlugin(): Plugin {
  const checkTcp = (port: number, timeoutMs = 1200): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host: "127.0.0.1" });
      const t = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, timeoutMs);
      sock.on("connect", () => {
        clearTimeout(t);
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        clearTimeout(t);
        resolve(false);
      });
    });
  return {
    name: "vision-engine-health-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/health", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (req.method === "GET") {
              const [gatewayUp, ollama, sd] = await Promise.all([checkTcp(18789), checkTcp(11434), checkTcp(7860)]);
              res.end(
                JSON.stringify({
                  gateway: gatewayUp,
                  ollama,
                  sd,
                  vault: !!resolveVault(),
                  remoteReadonly: REMOTE_READONLY,
                  ts: Date.now(),
                })
              );
              return;
            }
            if (req.method === "POST") {
              if (!isLocalReq(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "재시작은 PC(로컬)에서만 가능합니다" }));
                return;
              }
              const j = JSON.parse((await readBody(req)) || "{}");
              if (j.restart === "gateway") {
                restartGateway();
                res.end(JSON.stringify({ ok: true }));
                return;
              }
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "지원: {restart:\"gateway\"}" }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 200) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 아트 인턴 (로컬 Stable Diffusion 브리지) ── */

/**
 * A1111 호환 API(/sdapi/v1/txt2img)로 컨셉 아트를 생성한다.
 * 지원: AUTOMATIC1111 WebUI, SD.Next, Forge — `--api` 플래그로 실행돼 있어야 함.
 * 주소는 VE_SD_URL 환경변수로 변경 가능 (기본 http://127.0.0.1:7860).
 * 생성물은 projects/<id>/art/<ts>.png + <ts>.json(prompt 메타)로 저장된다.
 */
const SD_URL = process.env.VE_SD_URL || "http://127.0.0.1:7860";

function artApiPlugin(): Plugin {
  const artDir = (projectId: string) => path.join(projectDir(projectId), "art");
  // NVIDIA 이미지 제공자 + 규제 라우팅 모듈 (동적 import — 없어도 로컬 SD는 그대로 동작)
  let imgMod: any = null;
  const loadImg = async () => {
    if (imgMod) return imgMod;
    try {
      imgMod = await import("./server/image-provider.mjs");
    } catch {
      imgMod = null;
    }
    return imgMod;
  };
  return {
    name: "vision-engine-art-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/art", (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, "");

            // SD 서버 연결 상태
            if (sub === "/status" && req.method === "GET") {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              const img = await loadImg();
              const nvidia = !!img?.nvidiaAvailable?.();
              try {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), 2000);
                const r = await fetch(`${SD_URL}/sdapi/v1/options`, { signal: ctl.signal });
                clearTimeout(t);
                res.end(JSON.stringify({ connected: r.ok, url: SD_URL, nvidia }));
              } catch {
                res.end(JSON.stringify({ connected: false, url: SD_URL, nvidia }));
              }
              return;
            }

            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const dir = artDir(project);

            // 이미지 파일 서빙
            if (sub === "/file" && req.method === "GET") {
              const ts = Number(url.searchParams.get("ts") ?? 0);
              const f = path.join(dir, `${ts}.png`);
              if (!fs.existsSync(f)) {
                res.statusCode = 404;
                res.end("not found");
                return;
              }
              res.setHeader("Content-Type", "image/png");
              res.setHeader("Cache-Control", "max-age=86400");
              fs.createReadStream(f).pipe(res);
              return;
            }

            res.setHeader("Content-Type", "application/json; charset=utf-8");

            // 갤러리 목록
            if (req.method === "GET") {
              if (!fs.existsSync(dir)) {
                res.end(JSON.stringify({ images: [] }));
                return;
              }
              const images = fs
                .readdirSync(dir)
                .filter((f) => /^\d+\.json$/.test(f))
                .map((f) => {
                  try {
                    return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean)
                .sort((a: any, b: any) => b.ts - a.ts);
              res.end(JSON.stringify({ images }));
              return;
            }

            // 생성 — provider: "auto"(기본) | "local" | "nvidia"
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const prompt = String(j.prompt ?? "").trim();
              const negative = String(j.negative ?? "").trim();
              const request = String(j.request ?? "").trim();
              const provider = String(j.provider ?? "auto");
              if (!prompt) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "prompt 필요" }));
                return;
              }

              const img = await loadImg();
              const nvidiaOk = !!img?.nvidiaAvailable?.();
              const sensitive = !!img?.classifySensitive?.(request, prompt);

              // 로컬 SD 생성 (규제 게이트 없음 — 최종 목표)
              const genLocal = async (): Promise<string> => {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), 300_000);
                try {
                  const r = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: ctl.signal,
                    body: JSON.stringify({
                      prompt,
                      negative_prompt:
                        negative || "lowres, blurry, bad anatomy, watermark, text, signature, jpeg artifacts",
                      steps: 28,
                      width: 768,
                      height: 512,
                      cfg_scale: 6,
                      sampler_name: "DPM++ 2M",
                    }),
                  });
                  if (!r.ok) throw new Error(`로컬 SD 오류 (${r.status})`);
                  const sd = await r.json();
                  const b = sd?.images?.[0];
                  if (!b) throw new Error("로컬 SD가 이미지를 반환하지 않았습니다");
                  return b;
                } finally {
                  clearTimeout(t);
                }
              };
              // NVIDIA 클라우드 생성 (콘텐츠 정책 필터 있음)
              const genNvidia = async (): Promise<string> => {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), 120_000);
                try {
                  return await img.generateNvidiaImage(prompt, negative, { signal: ctl.signal });
                } finally {
                  clearTimeout(t);
                }
              };
              const shortMsg = (e: any) => String(e?.message ?? e).slice(0, 90);

              let b64 = "";
              let used = "local";
              let note = "";
              try {
                if (provider === "local" || (provider === "auto" && !nvidiaOk && !sensitive)) {
                  b64 = await genLocal();
                  used = "local";
                } else if (provider === "nvidia") {
                  try {
                    b64 = await genNvidia();
                    used = "nvidia";
                  } catch (e: any) {
                    b64 = await genLocal();
                    used = "local";
                    note = `NVIDIA 실패 → 로컬 폴백 (${shortMsg(e)})`;
                  }
                } else if (sensitive) {
                  // 자동: 규제 소지 → 로컬 우선 (클라우드는 이런 콘텐츠를 거부함)
                  try {
                    b64 = await genLocal();
                    used = "local";
                    note = "규제 소지 감지 → 로컬 SD로 생성";
                  } catch (e: any) {
                    throw new Error(
                      `이 요청은 규제 소지(폭력·유혈·성인 등)가 있어 로컬 SD가 필요합니다. 로컬 Stable Diffusion을 연결하세요 — 클라우드는 이런 콘텐츠를 거부합니다. (${shortMsg(e)})`
                    );
                  }
                } else {
                  // 자동: 안전 + NVIDIA 사용 가능 → 클라우드, 정책 거부/실패 시 로컬 폴백
                  try {
                    b64 = await genNvidia();
                    used = "nvidia";
                  } catch (e: any) {
                    try {
                      b64 = await genLocal();
                      used = "local";
                      note = `NVIDIA ${e?.name === "PolicyRefusal" ? "정책 거부" : "실패"} → 로컬 폴백`;
                    } catch {
                      throw e;
                    }
                  }
                }
              } catch (e: any) {
                res.statusCode = 502;
                res.end(JSON.stringify({ ok: false, error: shortMsg(e) }));
                return;
              }

              fs.mkdirSync(dir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(path.join(dir, `${ts}.png`), Buffer.from(b64, "base64"));
              fs.writeFileSync(
                path.join(dir, `${ts}.json`),
                JSON.stringify({ ts, prompt, negative, request, provider: used, note }, null, 0),
                "utf-8"
              );
              res.end(JSON.stringify({ ok: true, ts, provider: used, note }));
              return;
            }

            // 삭제 (휴지통으로)
            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              const ts = Number(url.searchParams.get("ts") ?? 0);
              trashFile(path.join(dir, `${ts}.png`));
              trashFile(path.join(dir, `${ts}.json`));
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            try {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            } catch {
              /* 헤더 이미 전송됨 */
            }
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 개발 인턴 (기능별 HTML 페이퍼 프로토타입) ── */

/**
 * 선임 개발자(td)가 확정한 개발 명세 중 기능 하나를 골라 만든 자기완결적 HTML 와이어프레임을
 * projects/<id>/prototypes/<ts>.html + <ts>.json(메타)로 저장한다. 생성 자체는 LLM 호출(클라이언트/스토어)에서
 * 끝나고, 이 플러그인은 결과물을 저장·목록화·서빙만 한다 (아트 인턴처럼 외부 GPU 서비스 호출 없음).
 */
function protoApiPlugin(): Plugin {
  const protoDir = (projectId: string) => path.join(projectDir(projectId), "prototypes");
  return {
    name: "vision-engine-proto-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/proto", (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, "");
            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const dir = protoDir(project);

            // HTML 파일 서빙 (iframe/새 탭에서 열기)
            if (sub === "/file" && req.method === "GET") {
              const ts = Number(url.searchParams.get("ts") ?? 0);
              const f = path.join(dir, `${ts}.html`);
              if (!fs.existsSync(f)) {
                res.statusCode = 404;
                res.end("not found");
                return;
              }
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "max-age=86400");
              fs.createReadStream(f).pipe(res);
              return;
            }

            res.setHeader("Content-Type", "application/json; charset=utf-8");

            // 목록
            if (req.method === "GET") {
              if (!fs.existsSync(dir)) {
                res.end(JSON.stringify({ items: [] }));
                return;
              }
              const items = fs
                .readdirSync(dir)
                .filter((f) => /^\d+\.json$/.test(f))
                .map((f) => {
                  try {
                    return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean)
                .sort((a: any, b: any) => b.ts - a.ts);
              res.end(JSON.stringify({ items }));
              return;
            }

            // 저장
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const feature = String(j.feature ?? "").trim();
              const html = String(j.html ?? "").trim();
              if (!feature || !html) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "feature/html 필요" }));
                return;
              }
              fs.mkdirSync(dir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(path.join(dir, `${ts}.html`), html, "utf-8");
              fs.writeFileSync(path.join(dir, `${ts}.json`), JSON.stringify({ ts, feature }, null, 0), "utf-8");
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            // 삭제 (휴지통으로)
            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              const ts = Number(url.searchParams.get("ts") ?? 0);
              trashFile(path.join(dir, `${ts}.html`));
              trashFile(path.join(dir, `${ts}.json`));
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            try {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            } catch {
              /* 헤더 이미 전송됨 */
            }
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 결정사항 원장 (조직의 기억) ── */

/**
 * 회의가 끝날 때마다 PM이 추출한 "확정 결정사항"을 projects/<id>/decisions.json에 적립한다.
 * 다음 회의의 모든 에이전트 프롬프트에 최근 결정이 자동 주입된다.
 */
function decisionsApiPlugin(): Plugin {
  const file = (id: string) => path.join(projectDir(id), "decisions.json");
  return {
    name: "vision-engine-decisions-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/decisions", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const f = file(project);
            const load = (): any[] => {
              try {
                return JSON.parse(fs.readFileSync(f, "utf-8"));
              } catch {
                return [];
              }
            };
            if (req.method === "GET") {
              res.end(JSON.stringify({ items: load() }));
              return;
            }
            if (req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const texts: string[] = Array.isArray(j.items) ? j.items.map((s: any) => String(s).slice(0, 300)).filter(Boolean) : [];
              const source = String(j.source ?? "").slice(0, 80);
              if (texts.length === 0) {
                res.end(JSON.stringify({ ok: true, added: 0 }));
                return;
              }
              const items = load();
              const ts = Date.now();
              for (const text of texts) {
                // 동일 문구 중복 적립 방지
                if (!items.some((it) => it.text === text)) items.push({ ts, text, source });
              }
              // 원장은 최근 200개까지 유지
              fs.writeFileSync(f, JSON.stringify(items.slice(-200), null, 1), "utf-8");
              res.end(JSON.stringify({ ok: true, added: texts.length }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 개발 착수 킷 (파일 저장소 + ZIP 내보내기) ── */

/** CRC32 (ZIP 포맷용) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 의존성 없는 ZIP 생성 (deflate) — 개발 착수 킷 다운로드용 */
function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 4) | now.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, "/"), "utf-8");
    const crc = crc32(e.data);
    const comp = zlib.deflateRawSync(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 파일명 플래그
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // made by
    ch.writeUInt16LE(20, 6); // needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs 전부 0
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cdirSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** kit/ 하위 경로만 허용 (경로 탈출·이상 문자 차단) */
function safeKitPath(p: string): string | null {
  const clean = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.length > 180) return null;
  if (!/^[\w\-./ ()가-힣]+$/.test(clean)) return null;
  return clean;
}

function walkDir(dir: string, base = ""): { path: string; size: number }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { path: string; size: number }[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === ".trash") continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkDir(full, rel));
    else out.push({ path: rel, size: st.size });
  }
  return out;
}

/**
 * 개발 착수 킷 — 에이전트들이 만든 실파일(밸런스 CSV·에셋 매니페스트·유니티 스켈레톤·그레이박스)을
 * projects/<id>/kit/ 에 저장하고, GDD·결정 원장·최근 보고서와 함께 ZIP 하나로 내보낸다.
 */
function kitApiPlugin(): Plugin {
  const kitDir = (id: string) => path.join(projectDir(id), "kit");
  return {
    name: "vision-engine-kit-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/kit", (req, res) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, "");
            const project = url.searchParams.get("project") ?? "";
            if (!isSafeId(project) || !fs.existsSync(projectDir(project))) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "project 확인 필요" }));
              return;
            }
            const dir = kitDir(project);

            // ZIP 내보내기 — kit/** + GDD + 결정 원장 + 최근 보고서 5건
            if (sub === "/zip" && req.method === "GET") {
              const entries: { name: string; data: Buffer }[] = [];
              for (const f of walkDir(dir)) entries.push({ name: f.path, data: fs.readFileSync(path.join(dir, f.path)) });
              const gddFile = path.join(projectDir(project), "GDD.md");
              if (fs.existsSync(gddFile)) entries.push({ name: "GDD.md", data: fs.readFileSync(gddFile) });
              const decFile = path.join(projectDir(project), "decisions.json");
              if (fs.existsSync(decFile)) {
                try {
                  const items = JSON.parse(fs.readFileSync(decFile, "utf-8"));
                  const md = ["# 결정사항 원장", "", ...items.map((it: any) => `- ${new Date(it.ts).toLocaleDateString("ko-KR")} ${it.text}`)].join("\n");
                  entries.push({ name: "decisions.md", data: Buffer.from(md, "utf-8") });
                } catch {
                  /* 원장 손상 시 생략 */
                }
              }
              const repDir = path.join(projectDir(project), "reports");
              if (fs.existsSync(repDir)) {
                const reps = fs
                  .readdirSync(repDir)
                  .filter((f) => /^\d+\.json$/.test(f))
                  .sort()
                  .slice(-5);
                for (const f of reps) {
                  try {
                    const r = JSON.parse(fs.readFileSync(path.join(repDir, f), "utf-8"));
                    const safe = String(r.title ?? "report").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
                    entries.push({ name: `reports/${f.replace(".json", "")}-${safe}.md`, data: Buffer.from(String(r.markdown ?? ""), "utf-8") });
                  } catch {
                    /* 개별 보고서 손상 시 생략 */
                  }
                }
              }
              if (entries.length === 0) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "킷이 비어 있습니다 — 먼저 개발 착수 킷을 생성하세요" }));
                return;
              }
              const zip = buildZip(entries);
              res.setHeader("Content-Type", "application/zip");
              res.setHeader("Content-Disposition", `attachment; filename="dev-kit-${project}.zip"`);
              res.end(zip);
              return;
            }

            // 개별 파일 서빙 (미리보기)
            if (sub === "/file" && req.method === "GET") {
              const rel = safeKitPath(url.searchParams.get("path") ?? "");
              const f = rel ? path.join(dir, rel) : "";
              if (!rel || !f.startsWith(dir) || !fs.existsSync(f)) {
                res.statusCode = 404;
                res.end("not found");
                return;
              }
              const mime = f.endsWith(".html") ? "text/html" : f.endsWith(".csv") ? "text/csv" : "text/plain";
              res.setHeader("Content-Type", `${mime}; charset=utf-8`);
              fs.createReadStream(f).pipe(res);
              return;
            }

            res.setHeader("Content-Type", "application/json; charset=utf-8");

            // 파일 목록
            if (req.method === "GET") {
              res.end(JSON.stringify({ files: walkDir(dir) }));
              return;
            }

            // 파일 일괄 저장 (에이전트 산출물)
            if (sub === "/files" && req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const files: any[] = Array.isArray(j.files) ? j.files : [];
              let saved = 0;
              for (const it of files.slice(0, 30)) {
                const rel = safeKitPath(String(it?.path ?? ""));
                const content = String(it?.content ?? "");
                if (!rel || !content || content.length > 300_000) continue;
                const full = path.join(dir, rel);
                if (!full.startsWith(dir)) continue;
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, content, "utf-8");
                saved++;
              }
              res.end(JSON.stringify({ ok: true, saved }));
              return;
            }

            // 킷 비우기 (휴지통으로)
            if (req.method === "DELETE") {
              if (blockRemoteWrite(req, res)) return;
              for (const f of walkDir(dir)) trashFile(path.join(dir, f.path));
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            try {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            } catch {
              /* 헤더 이미 전송됨 */
            }
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 사무실 배경 (아트 인턴이 그리는 커스텀 배경) ── */

/**
 * 사무실 뷰의 커스텀 배경을 로컬 SD로 생성해 public/office/custom.png 에 저장한다.
 * 기본 배경(bg-day/night/cat)은 정적 에셋이고, 이 API는 "새 배경" 한 장만 관리한다.
 * 생성은 PC 로컬 요청만 허용 — 저장 위치가 앱 소스 트리(public/)이기 때문.
 */
function officeBgPlugin(): Plugin {
  const officeDir = path.resolve(__dirname, "public", "office");
  const metaFile = path.join(officeDir, "custom.json");
  return {
    name: "vision-engine-office-bg",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/office-bg", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (req.method === "GET") {
              let meta: any = null;
              if (fs.existsSync(metaFile) && fs.existsSync(path.join(officeDir, "custom.png"))) {
                try {
                  meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
                } catch {
                  meta = null;
                }
              }
              res.end(JSON.stringify({ custom: meta }));
              return;
            }
            if (req.method === "POST") {
              if (!isLocalReq(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "배경 생성은 PC(로컬)에서만 가능합니다" }));
                return;
              }
              const j = JSON.parse((await readBody(req)) || "{}");
              const prompt = String(j.prompt ?? "").trim();
              const request = String(j.request ?? "").trim();
              if (!prompt) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "prompt 필요" }));
                return;
              }
              const ctl = new AbortController();
              const t = setTimeout(() => ctl.abort(), 300_000);
              let sd: any;
              try {
                const r = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  signal: ctl.signal,
                  body: JSON.stringify({
                    prompt,
                    negative_prompt:
                      String(j.negative ?? "").trim() ||
                      "photo, photorealistic, realistic, 3d render, people, person, human, character, face, text, letters, watermark, signature, logo, blurry, lowres",
                    steps: 30,
                    width: 768,
                    height: 448,
                    cfg_scale: 6.5,
                    sampler_name: "DPM++ 2M",
                  }),
                });
                if (!r.ok) throw new Error(`SD 서버 오류 (${r.status})`);
                sd = await r.json();
              } finally {
                clearTimeout(t);
              }
              const b64 = sd?.images?.[0];
              if (!b64) throw new Error("SD가 이미지를 반환하지 않았습니다");
              fs.mkdirSync(officeDir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(path.join(officeDir, "custom.png"), Buffer.from(b64, "base64"));
              fs.writeFileSync(metaFile, JSON.stringify({ ts, prompt, request }), "utf-8");
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: AI 모델 프로바이더 (GitHub Models / NVIDIA NIM) ── */

/**
 * OpenClaw 프로바이더 템플릿. 키가 등록될 때 openclaw.json 에 병합된다.
 * - api "openai-completions" + compat: gpt-5 계열은 max_completion_tokens,
 *   NVIDIA NIM 은 max_tokens 만 받으므로 모델별로 명시한다.
 * - store/developer role 은 두 서비스 모두 미지원 가능성이 있어 끈다.
 */
const PROVIDER_TEMPLATES: Record<string, any> = {
  github: {
    baseUrl: "https://models.github.ai/inference",
    api: "openai-completions",
    models: [
      {
        id: "openai/gpt-5-mini",
        name: "GPT-5 mini (GitHub Models)",
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        compat: { maxTokensField: "max_completion_tokens", supportsStore: false, supportsDeveloperRole: false },
      },
      {
        id: "openai/gpt-5",
        name: "GPT-5 (GitHub Models)",
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        compat: { maxTokensField: "max_completion_tokens", supportsStore: false, supportsDeveloperRole: false },
      },
    ],
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
    // 2026-07 카탈로그 실측 기준 — 응답 빠르고 한국어 정상인 모델만 (qwen3.5-397b는 대기열 2분+로 제외)
    models: [
      {
        id: "moonshotai/kimi-k2.6",
        name: "Kimi K2.6 (NVIDIA)",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 8192,
        compat: {
          maxTokensField: "max_tokens",
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
      {
        id: "qwen/qwen3-next-80b-a3b-instruct",
        name: "Qwen3 Next 80B (NVIDIA)",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 8192,
        compat: {
          maxTokensField: "max_tokens",
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
      {
        id: "deepseek-ai/deepseek-v4-flash",
        name: "DeepSeek V4 Flash (NVIDIA)",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 8192,
        compat: {
          maxTokensField: "max_tokens",
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B (NVIDIA)",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 8192,
        compat: {
          maxTokensField: "max_tokens",
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
    ],
  },
};

/** 사용자에게 보여줄 모델 라벨 */
const MODEL_LABELS: Record<string, { label: string; note?: string }> = {
  "ollama/qwen3:8b": { label: "로컬 Qwen3 8B", note: "무료·무제한·오프라인 (품질 낮음)" },
  // GitHub Models 무료 티어는 요청당 4,000토큰 제한이라 에이전트 프롬프트가 안 들어간다.
  // GitHub 설정에서 Models 유료 결제(또는 Copilot 유료 플랜)를 켜면 제한이 풀려 사용 가능.
  "github/openai/gpt-5-mini": { label: "GPT-5 mini · GitHub Models", note: "⚠️ GitHub 유료 결제 필요 (무료 티어는 4K 제한)" },
  "github/openai/gpt-5": { label: "GPT-5 · GitHub Models", note: "⚠️ GitHub 유료 결제 필요 (무료 티어는 4K 제한)" },
  "nvidia/moonshotai/kimi-k2.6": { label: "Kimi K2.6 · NVIDIA", note: "헤드급 — PM 추천" },
  "nvidia/qwen/qwen3-next-80b-a3b-instruct": { label: "Qwen3 Next 80B · NVIDIA", note: "빠름 — 팀원 추천" },
  "nvidia/deepseek-ai/deepseek-v4-flash": { label: "DeepSeek V4 Flash · NVIDIA", note: "빠름" },
  "nvidia/openai/gpt-oss-120b": { label: "GPT-OSS 120B · NVIDIA", note: "균형" },
};

function hasProviderKey(cfg: any, provider: string): boolean {
  const key = cfg?.models?.providers?.[provider]?.apiKey;
  return typeof key === "string" && key.length > 10;
}

function modelsApiPlugin(): Plugin {
  return {
    name: "vision-engine-models-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/models", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CFG, "utf-8"));

            if (req.method === "GET") {
              const current =
                cfg?.agents?.defaults?.model?.primary ?? cfg?.agents?.list?.[0]?.model ?? "ollama/qwen3:8b";
              // 에이전트별 현재 모델 (역할별 배정 UI용)
              const agents: Record<string, string> = {};
              for (const a of cfg?.agents?.list ?? []) agents[a.id] = a.model ?? current;
              const providers = {
                ollama: true,
                github: hasProviderKey(cfg, "github"),
                nvidia: hasProviderKey(cfg, "nvidia"),
              };
              const options: { id: string; label: string; note?: string }[] = [];
              for (const m of cfg?.models?.providers?.ollama?.models ?? []) {
                const id = `ollama/${m.id}`;
                options.push({ id, ...(MODEL_LABELS[id] ?? { label: m.name ?? m.id }) });
              }
              for (const provider of ["github", "nvidia"] as const) {
                if (!providers[provider]) continue;
                for (const m of cfg?.models?.providers?.[provider]?.models ?? []) {
                  const id = `${provider}/${m.id}`;
                  options.push({ id, ...(MODEL_LABELS[id] ?? { label: m.name ?? m.id }) });
                }
              }
              res.end(JSON.stringify({ current, agents, providers, options }));
              return;
            }

            if (req.method === "POST") {
              if (!isLocalReq(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "보안: 모델·키 설정 변경은 PC(로컬)에서만 가능합니다" }));
                return;
              }
              const j = JSON.parse((await readBody(req)) || "{}");

              // ① 프로바이더 키 등록
              if (j.registerKey) {
                const provider = String(j.registerKey.provider ?? "");
                const key = String(j.registerKey.key ?? "").trim();
                if (!PROVIDER_TEMPLATES[provider] || key.length < 10) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ ok: false, error: "provider/key 확인 필요" }));
                  return;
                }
                cfg.models = cfg.models || {};
                cfg.models.providers = cfg.models.providers || {};
                cfg.models.providers[provider] = { ...PROVIDER_TEMPLATES[provider], apiKey: key };
                fs.writeFileSync(OPENCLAW_CFG, JSON.stringify(cfg, null, 2), "utf-8");
                restartGateway();
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              // ② 역할별 모델 배정 (배치 — 게이트웨이 재시작 1회)
              //    body: { agentModels: { pm: "github/openai/gpt-5", scenario: "ollama/qwen3:8b", ... } }
              if (j.agentModels && typeof j.agentModels === "object") {
                const entries = Object.entries(j.agentModels as Record<string, string>);
                if (entries.length === 0) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ ok: false, error: "agentModels 비어 있음" }));
                  return;
                }
                const validModel = (model: string): string | null => {
                  const slash = model.indexOf("/");
                  const provider = slash > 0 ? model.slice(0, slash) : "";
                  const modelId = slash > 0 ? model.slice(slash + 1) : "";
                  const known = (cfg?.models?.providers?.[provider]?.models ?? []).some((m: any) => m.id === modelId);
                  if (!known) return `알 수 없는 모델: ${model}`;
                  if (provider !== "ollama" && !hasProviderKey(cfg, provider)) return `${provider} API 키를 먼저 등록하세요`;
                  return null;
                };
                const agentIds = new Set((cfg?.agents?.list ?? []).map((a: any) => a.id));
                for (const [agentId, model] of entries) {
                  if (!agentIds.has(agentId)) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ ok: false, error: `알 수 없는 에이전트: ${agentId}` }));
                    return;
                  }
                  const err = validModel(String(model));
                  if (err) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ ok: false, error: err }));
                    return;
                  }
                }
                for (const a of cfg.agents.list ?? []) {
                  const next = (j.agentModels as Record<string, string>)[a.id];
                  if (next) a.model = next;
                }
                fs.writeFileSync(OPENCLAW_CFG, JSON.stringify(cfg, null, 2), "utf-8");
                restartGateway();
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              // ③ 전 에이전트 모델 전환
              if (typeof j.model === "string" && j.model) {
                const model = j.model.trim();
                const slash = model.indexOf("/");
                const provider = slash > 0 ? model.slice(0, slash) : "";
                const modelId = slash > 0 ? model.slice(slash + 1) : "";
                const known = (cfg?.models?.providers?.[provider]?.models ?? []).some((m: any) => m.id === modelId);
                if (!known) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ ok: false, error: `알 수 없는 모델: ${model}` }));
                  return;
                }
                if (provider !== "ollama" && !hasProviderKey(cfg, provider)) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ ok: false, error: `${provider} API 키를 먼저 등록하세요` }));
                  return;
                }
                cfg.agents = cfg.agents || {};
                cfg.agents.defaults = cfg.agents.defaults || {};
                cfg.agents.defaults.model = { ...(cfg.agents.defaults.model || {}), primary: model };
                for (const a of cfg.agents.list ?? []) a.model = model;
                fs.writeFileSync(OPENCLAW_CFG, JSON.stringify(cfg, null, 2), "utf-8");
                restartGateway();
                res.end(JSON.stringify({ ok: true, model }));
                return;
              }

              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "registerKey, agentModels 또는 model 필요" }));
              return;
            }

            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 에이전트 실행 브리지 ───────────────────── */

/** 설치된 OpenClaw CLI 엔트리(dist/index.js)를 찾는다 */
function findOpenclawEntry(): string | null {
  const home = os.homedir();
  const candidates = [
    process.env.OPENCLAW_ENTRY ?? "",
    path.join(home, "AppData/Roaming/npm/node_modules/openclaw/dist/index.js"),
    // Claude 앱 샌드박스(MSIX 가상화)로 npm 전역 설치가 들어간 경우
    path.join(
      home,
      "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/npm/node_modules/openclaw/dist/index.js"
    ),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * 게이트웨이 WS의 operator.write 스코프는 디바이스 페어링이 필요하므로,
 * 디바이스 신원을 자동 처리하는 공식 CLI(openclaw agent --json)를
 * 로컬에서 실행해 결과를 반환한다. (127.0.0.1/tailnet 전용)
 *   POST /api/agent  body { agentId, message, sessionKey? }
 */
function agentBridgePlugin(): Plugin {
  return {
    name: "vision-engine-agent-bridge",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/agent", (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: "POST only" }));
          return;
        }
        // 원격 읽기전용 모드에서는 에이전트 실행도 차단 (열람만 허용)
        if (blockRemoteWrite(req, res)) return;
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let agentId = "";
          let message = "";
          let sessionKey = "";
          try {
            const j = JSON.parse(body || "{}");
            agentId = String(j.agentId ?? "");
            message = String(j.message ?? "");
            sessionKey = String(j.sessionKey ?? "");
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "잘못된 JSON 본문" }));
            return;
          }
          if (!agentId || !message) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: "agentId, message 필요" }));
            return;
          }
          const entry = findOpenclawEntry();
          if (!entry) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: "openclaw CLI를 찾지 못했습니다 (npm i -g openclaw)" }));
            return;
          }
          const args = [entry, "agent", "--agent", agentId, "--message", message, "--json", "--timeout", "420"];
          if (sessionKey) args.push("--session-key", sessionKey);
          const child = spawn(process.execPath, args, { shell: false, windowsHide: true });
          let out = "";
          let err = "";
          const killer = setTimeout(() => child.kill(), 430_000);
          // 클라이언트가 요청을 중단(⏹)하면 CLI 실행도 즉시 종료 — 오케스트레이션 즉시 중단
          // (req의 close는 본문 수신 완료 시에도 발생하므로 res의 close로 조기 종료만 감지)
          res.on("close", () => {
            if (!res.writableEnded) child.kill();
          });
          child.stdout.on("data", (d) => (out += d.toString("utf-8")));
          child.stderr.on("data", (d) => (err += d.toString("utf-8")));
          child.on("close", () => {
            clearTimeout(killer);
            const jsonStart = out.indexOf("{");
            if (jsonStart >= 0) {
              try {
                const parsed = JSON.parse(out.slice(jsonStart));
                res.end(JSON.stringify({ ok: true, run: parsed }));
                return;
              } catch {
                /* fallthrough */
              }
            }
            res.statusCode = 502;
            res.end(
              JSON.stringify({
                ok: false,
                error: (err || out || "CLI 응답 없음").slice(0, 600),
              })
            );
          });
        });
      });
    },
  };
}

/* ── dev 서버 바인딩 ─────────────────────────────────── */

/**
 * VE_EXPOSE=tailnet  → Tailscale IPv4 에만 바인딩(폰 등 tailnet 기기에서 접속 가능,
 *                      LAN·공용망에는 노출 안 됨). 게이트웨이는 loopback 유지.
 * 그 외              → 127.0.0.1 (로컬 전용, 기본·안전값)
 */
function resolveDevHost(): string {
  if (process.env.VE_EXPOSE !== "tailnet") return "127.0.0.1";
  const candidates = [
    "tailscale",
    "C:/Program Files/Tailscale/tailscale.exe",
    "C:/Program Files (x86)/Tailscale/tailscale.exe",
  ];
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ["ip", "-4"], { encoding: "utf-8", timeout: 5000 }).trim();
      const ip = out.split(/\r?\n/)[0]?.trim();
      if (ip && /^100\./.test(ip)) {
        console.log(`[vite] Tailscale 노출 모드 — ${ip}:5199 에 바인딩 (폰에서 이 주소로 접속)`);
        return ip;
      }
    } catch {
      /* 다음 후보 시도 */
    }
  }
  console.warn("[vite] VE_EXPOSE=tailnet 이지만 Tailscale IP를 못 찾음 → 모든 인터페이스(0.0.0.0)로 폴백");
  return "0.0.0.0";
}

/* ── 플러그인: MCP 허브 (config/mcp.json의 도구 서버 연결·노출) ── */
function mcpApiPlugin(): Plugin {
  // 서버 모듈은 ESM 동적 import — MCP SDK를 안 쓰는 환경에서도 안전하게 로드 실패를 격리
  let hub: any = null;
  const load = async () => {
    if (hub) return hub;
    hub = await import("./server/mcp-hub.mjs");
    return hub;
  };
  return {
    name: "vision-engine-mcp-api",
    configureServer(server: ViteDevServer) {
      // 서버 기동 시 백그라운드로 허브 연결 (실패해도 앱엔 영향 없음)
      void load()
        .then((h) => h.startHub())
        .catch(() => {});
      server.middlewares.use("/api/mcp", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const h = await load();
            const url = new URL(req.url ?? "/", "http://local");
            const sub = url.pathname.replace(/\/+$/, "");
            if (sub === "/unity" && req.method === "GET") {
              res.end(JSON.stringify({ dir: h.readUnityDir() }));
              return;
            }
            if (req.method === "GET") {
              if (!h.isStarted()) await h.startHub();
              res.end(JSON.stringify({ servers: h.statusList(), tools: h.allTools(), assignments: h.assignmentsByServer() }));
              return;
            }
            if (sub === "/reconnect" && req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const servers = await h.reconnect();
              res.end(JSON.stringify({ ok: true, servers }));
              return;
            }
            if (sub === "/unity" && req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const out = h.setUnityDir(String(j.dir ?? ""));
              await h.reconnect();
              res.end(JSON.stringify({ ok: true, ...out }));
              return;
            }
            if (sub === "/call" && req.method === "POST") {
              if (blockRemoteWrite(req, res)) return;
              const j = JSON.parse((await readBody(req)) || "{}");
              const out = await h.callTool(String(j.server), String(j.name), j.args ?? {});
              res.end(JSON.stringify({ ok: true, ...out }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
          }
        })();
      });
    },
  };
}

/* ── 플러그인: 개발 작업 (다이렉트 프로바이더 + MCP 툴 루프) ── */
function devTaskApiPlugin(): Plugin {
  let mod: any = null;
  const load = async () => {
    if (mod) return mod;
    mod = await import("./server/dev-provider.mjs");
    return mod;
  };
  const sse = (req: any, res: any, run: (send: (o: unknown) => void, body: any) => Promise<void>) => {
    void (async () => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (blockRemoteWrite(req, res)) return;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        await run(send, body);
      } catch (e: any) {
        send({ kind: "error", text: String(e?.message ?? e).slice(0, 300) });
      }
      res.end();
    })();
  };
  return {
    name: "vision-engine-devtask-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/dev-task", (req, res) =>
        sse(req, res, async (send, j) => {
          const agentId = String(j.agentId || "");
          const task = String(j.task || "").trim();
          if (!agentId || !task) return void send({ kind: "error", text: "agentId·task 필요" });
          const dp = await load();
          const out = await dp.runDevTask({
            agentId,
            task,
            model: j.model,
            maxSteps: Math.min(Number(j.maxSteps) || 8, 12),
            onStep: (step: unknown) => send(step),
          });
          send({ kind: "done", final: out.final });
        })
      );
      server.middlewares.use("/api/dev-meeting", (req, res) =>
        sse(req, res, async (send, j) => {
          const leadId = String(j.leadId || j.agentId || "");
          const task = String(j.task || "").trim();
          if (!leadId || !task) return void send({ kind: "error", text: "leadId·task 필요" });
          const dp = await load();
          await dp.runDevMeeting({ leadId, task, onStep: (step: unknown) => send(step) });
        })
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    projectsApiPlugin(),
    gddApiPlugin(),
    chatsApiPlugin(),
    reportsApiPlugin(),
    artApiPlugin(),
    protoApiPlugin(),
    decisionsApiPlugin(),
    kitApiPlugin(),
    officeBgPlugin(),
    knowledgeApiPlugin(),
    obsidianApiPlugin(),
    healthApiPlugin(),
    braveKeyPlugin(),
    modelsApiPlugin(),
    agentBridgePlugin(),
    mcpApiPlugin(),
    devTaskApiPlugin(),
  ],
  server: {
    port: 5199,
    // 포트가 차 있으면 조용히 5200으로 옮겨 뜨는 대신 명확히 실패시킨다 (중복 실행 방지)
    strictPort: true,
    host: resolveDevHost(),
    allowedHosts: true,
    proxy: {
      // 브라우저 -> Vite -> OpenClaw 게이트웨이 WebSocket 프록시(서버측).
      "/gateway-ws": {
        target: "ws://127.0.0.1:18789",
        ws: true,
        changeOrigin: true,
        rewrite: () => "/",
        headers: { Origin: "http://127.0.0.1:18789" },
      },
    },
  },
});
