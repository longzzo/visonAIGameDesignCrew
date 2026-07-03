import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
              const id = url.searchParams.get("id") ?? "";
              if (!isSafeId(id) || !fs.existsSync(projectDir(id))) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "프로젝트 없음" }));
                return;
              }
              fs.rmSync(projectDir(id), { recursive: true, force: true });
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
              const { markdown } = JSON.parse((await readBody(req)) || "{}");
              if (typeof markdown !== "string") {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "markdown 필드 필요" }));
                return;
              }
              snapshotGdd(project, markdown);
              fs.mkdirSync(path.dirname(GDD_PATH), { recursive: true });
              fs.writeFileSync(GDD_PATH, markdown, "utf-8");
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
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            if (req.method === "DELETE") {
              const ts = Number(url.searchParams.get("ts") ?? 0);
              const f = path.join(dir, `${ts}.json`);
              if (!fs.existsSync(f)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: "보고서 없음" }));
                return;
              }
              fs.rmSync(f, { force: true });
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
              const j = JSON.parse((await readBody(req)) || "{}");
              const title = String(j.title ?? "").trim().slice(0, 120);
              const summary = String(j.summary ?? "").trim();
              const content = String(j.content ?? "");
              const agents = Array.isArray(j.agents) ? j.agents.map(String) : ["all"];
              if (!title || !summary) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: "title/summary 필요" }));
                return;
              }
              fs.mkdirSync(dir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(
                path.join(dir, `${ts}.json`),
                JSON.stringify({ ts, title, summary, content: content.slice(0, 30000), agents }, null, 0),
                "utf-8"
              );
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            if (req.method === "DELETE") {
              const ts = Number(url.searchParams.get("ts") ?? 0);
              fs.rmSync(path.join(dir, `${ts}.json`), { force: true });
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
              try {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), 2000);
                const r = await fetch(`${SD_URL}/sdapi/v1/options`, { signal: ctl.signal });
                clearTimeout(t);
                res.end(JSON.stringify({ connected: r.ok, url: SD_URL }));
              } catch {
                res.end(JSON.stringify({ connected: false, url: SD_URL }));
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

            // 생성
            if (req.method === "POST") {
              const j = JSON.parse((await readBody(req)) || "{}");
              const prompt = String(j.prompt ?? "").trim();
              const negative = String(j.negative ?? "").trim();
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
                      negative || "lowres, blurry, bad anatomy, watermark, text, signature, jpeg artifacts",
                    steps: 28,
                    width: 768,
                    height: 512,
                    cfg_scale: 6,
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
              fs.mkdirSync(dir, { recursive: true });
              const ts = Date.now();
              fs.writeFileSync(path.join(dir, `${ts}.png`), Buffer.from(b64, "base64"));
              fs.writeFileSync(
                path.join(dir, `${ts}.json`),
                JSON.stringify({ ts, prompt, negative, request }, null, 0),
                "utf-8"
              );
              res.end(JSON.stringify({ ok: true, ts }));
              return;
            }

            // 삭제
            if (req.method === "DELETE") {
              const ts = Number(url.searchParams.get("ts") ?? 0);
              fs.rmSync(path.join(dir, `${ts}.png`), { force: true });
              fs.rmSync(path.join(dir, `${ts}.json`), { force: true });
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

export default defineConfig({
  plugins: [
    react(),
    projectsApiPlugin(),
    gddApiPlugin(),
    chatsApiPlugin(),
    reportsApiPlugin(),
    artApiPlugin(),
    knowledgeApiPlugin(),
    braveKeyPlugin(),
    modelsApiPlugin(),
    agentBridgePlugin(),
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
