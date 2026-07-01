import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GDD_PATH = path.resolve(__dirname, "../workspace/GDD.md");

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
 * 에이전트 실행 브리지 — 게이트웨이 WS의 operator.write 스코프는 디바이스 페어링이
 * 필요하므로, 디바이스 신원을 자동 처리하는 공식 CLI(openclaw agent --json)를
 * 로컬에서 실행해 결과를 반환한다. (127.0.0.1 전용)
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

/**
 * 마스터 GDD 파일(vision-engine/workspace/GDD.md)을 브라우저에서
 * 읽고 쓸 수 있게 하는 로컬 전용 API.
 *   GET  /api/gdd  -> { markdown, mtime }
 *   POST /api/gdd  -> body { markdown } 저장 후 { ok, mtime }
 */
function gddApiPlugin(): Plugin {
  return {
    name: "vision-engine-gdd-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/gdd", (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          if (req.method === "GET") {
            const markdown = fs.existsSync(GDD_PATH)
              ? fs.readFileSync(GDD_PATH, "utf-8")
              : "# 마스터 GDD\n\n_(아직 없음)_\n";
            const mtime = fs.existsSync(GDD_PATH)
              ? fs.statSync(GDD_PATH).mtimeMs
              : 0;
            res.end(JSON.stringify({ markdown, mtime }));
            return;
          }
          if (req.method === "POST") {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
              try {
                const { markdown } = JSON.parse(body || "{}");
                if (typeof markdown !== "string") {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ ok: false, error: "markdown 필드 필요" }));
                  return;
                }
                fs.mkdirSync(path.dirname(GDD_PATH), { recursive: true });
                fs.writeFileSync(GDD_PATH, markdown, "utf-8");
                res.end(JSON.stringify({ ok: true, mtime: fs.statSync(GDD_PATH).mtimeMs }));
              } catch (e: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
              }
            });
            return;
          }
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
        }
      });
    },
  };
}

/**
 * 바인딩할 호스트 결정.
 *   VE_EXPOSE=tailnet  → Tailscale IPv4 에만 바인딩(폰 등 tailnet 기기에서 접속 가능,
 *                        LAN·공용망에는 노출 안 됨). 게이트웨이는 그대로 127.0.0.1 로 두고
 *                        이 dev 서버가 서버측에서 프록시하므로 게이트웨이 자체는 외부 비노출.
 *   그 외              → 127.0.0.1 (로컬 전용, 기본·안전값)
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
  plugins: [react(), gddApiPlugin(), agentBridgePlugin()],
  server: {
    port: 5199,
    host: resolveDevHost(),
    // tailnet IP/매직DNS 호스트명으로 들어오는 요청을 Vite가 차단하지 않도록 허용
    allowedHosts: true,
    proxy: {
      // 브라우저 -> Vite -> OpenClaw 게이트웨이 WebSocket 프록시(서버측).
      // 폰에서 접속해도 게이트웨이 호출은 이 PC의 loopback 에서 일어난다.
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
