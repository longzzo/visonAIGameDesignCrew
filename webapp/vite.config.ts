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

/* ── 플러그인: 마스터 GDD 읽기/쓰기 (프로젝트별) ───────── */

function gddApiPlugin(): Plugin {
  return {
    name: "vision-engine-gdd-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/gdd", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url ?? "/", "http://local");
            const project = url.searchParams.get("project");
            const GDD_PATH = gddPathOf(project);
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
  plugins: [react(), projectsApiPlugin(), gddApiPlugin(), agentBridgePlugin()],
  server: {
    port: 5199,
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
