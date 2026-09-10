// OpenClaw 이벤트 릴레이 — 게이트웨이 토큰은 서버에만 두고 브라우저에는
// 상태와 UI 연출에 필요한 agent/chat 이벤트만 전달한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const OPENCLAW_CFG = path.join(os.homedir(), ".openclaw", "openclaw.json");
const EVENT_ALLOW = new Set(["agent", "chat"]);

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CFG, "utf-8"));
  } catch {
    return {};
  }
}

function readAgentRoster(config) {
  if (Array.isArray(config?.agents?.list)) return config.agents.list;
  const entries = config?.agents?.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return [];
  return Object.entries(entries).map(([id, agent]) => ({ id, ...(agent && typeof agent === "object" ? agent : {}) }));
}

function safePayload(payload = {}) {
  const out = {};
  for (const key of ["sessionKey", "state", "role", "direction", "deltaText", "message"]) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  if (typeof out.deltaText === "string") out.deltaText = out.deltaText.slice(0, 32_000);
  if (typeof out.message === "string") out.message = out.message.slice(0, 64_000);
  return out;
}

export function gatewayRelayPlugin() {
  const clients = new Set();
  let upstream = null;
  let connected = false;
  let detail = "게이트웨이 연결 대기";
  let reconnectTimer = null;
  let connectTimer = null;
  let stopped = false;
  let seq = 0;

  const send = (res, frame) => {
    try {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    } catch {
      clients.delete(res);
    }
  };
  const broadcast = (frame) => clients.forEach((res) => send(res, frame));
  const broadcastStatus = () => broadcast({ type: "event", event: "gateway.status", payload: { connected, detail } });

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectUpstream();
    }, 2500);
  };

  const connectUpstream = () => {
    if (stopped || upstream?.readyState === WebSocket.OPEN || upstream?.readyState === WebSocket.CONNECTING) return;
    const cfg = readConfig();
    const port = Number(cfg?.gateway?.port) || 18789;
    const token = cfg?.gateway?.auth?.token;
    if (!token || typeof token !== "string") {
      connected = false;
      detail = "OpenClaw 게이트웨이 토큰을 찾지 못했습니다";
      broadcastStatus();
      scheduleReconnect();
      return;
    }

    let connectSent = false;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    upstream = ws;
    detail = `ws://127.0.0.1:${port}`;

    const sendConnect = () => {
      if (connectSent || ws.readyState !== WebSocket.OPEN) return;
      connectSent = true;
      ws.send(JSON.stringify({
        type: "req",
        id: `ve-relay-${++seq}`,
        method: "connect",
        params: {
          minProtocol: 4,
          maxProtocol: 4,
          client: { id: "cli", version: "3.6.0", platform: process.platform, mode: "cli" },
          role: "operator",
          scopes: ["operator.read"],
          auth: { token },
          locale: "ko-KR"
        }
      }));
    };

    ws.on("open", () => {
      clearTimeout(connectTimer);
      connectTimer = setTimeout(sendConnect, 1200);
    });
    ws.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (frame?.type === "event" && frame.event === "connect.challenge") {
        sendConnect();
        return;
      }
      if (frame?.type === "res" && frame.ok && frame.payload?.type === "hello-ok") {
        connected = true;
        detail = `OpenClaw ${frame.payload?.server?.version ?? ""}`.trim();
        broadcastStatus();
        return;
      }
      if (frame?.type === "event" && EVENT_ALLOW.has(frame.event)) {
        broadcast({ type: "event", event: frame.event, payload: safePayload(frame.payload), seq: frame.seq });
      }
    });
    ws.on("error", (error) => {
      connected = false;
      detail = String(error?.message ?? error).slice(0, 180);
      broadcastStatus();
    });
    ws.on("close", () => {
      clearTimeout(connectTimer);
      upstream = null;
      connected = false;
      detail = "게이트웨이 연결이 끊겼습니다";
      broadcastStatus();
      scheduleReconnect();
    });
  };

  return {
    name: "vision-engine-gateway-relay",
    configureServer(server) {
      connectUpstream();
      server.httpServer?.once("close", () => {
        stopped = true;
        clearTimeout(reconnectTimer);
        clearTimeout(connectTimer);
        try { upstream?.close(); } catch { /* noop */ }
      });
      server.middlewares.use("/api/gateway", (req, res) => {
        const url = new URL(req.url ?? "/", "http://local");
        const sub = url.pathname.replace(/\/+$/, "") || "/";
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: "GET only" }));
          return;
        }
        if (sub === "/status" || sub === "/") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, connected, detail }));
          return;
        }
        if (sub === "/agents") {
          const cfg = readConfig();
          const agents = readAgentRoster(cfg).map((agent) => ({ id: agent.id, name: agent.name, model: agent.model }));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: true, agents }));
          return;
        }
        if (sub === "/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
          });
          clients.add(res);
          send(res, { type: "event", event: "gateway.status", payload: { connected, detail } });
          const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
          res.on("close", () => {
            clearInterval(keepalive);
            clients.delete(res);
          });
          connectUpstream();
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "not found" }));
      });
    }
  };
}
