// OpenClaw 게이트웨이 WebSocket 클라이언트 (Vision Engine 웹앱 전용 최소 구현)
//
// 프로토콜 개요 (docs.openclaw.ai/gateway/protocol):
//  - 서버가 { type:"event", event:"connect.challenge" } 를 보내면
//    클라이언트가 { type:"req", method:"connect", params:{ auth:{token}, ... } } 로 응답
//  - 이후 { type:"req"|"res"|"event" } JSON 프레임을 주고받는다.
//  - 메시지 전송: method "chat.send" (스트리밍 이벤트 "chat") 또는 method "agent" (완료 시 res)

export type EventFrame = { type: "event"; event: string; payload?: any; seq?: number };
export type ConnStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface RunUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface RunResult {
  text: string;
  usage?: RunUsage;
  raw?: any;
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const CONNECT_TIMEOUT = 12_000;
// 로컬 8B 모델은 긴 산출물에 수 분이 걸릴 수 있다.
const DEFAULT_REQ_TIMEOUT = 420_000;

function env(key: string): string {
  return ((import.meta as any).env?.[key] as string) || "";
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private eventListeners = new Set<(f: EventFrame) => void>();
  private statusListeners = new Set<(s: ConnStatus, detail: string) => void>();
  private seq = 0;
  private connectSent = false;
  private connectResolve: ((ok: boolean) => void) | null = null;
  private manualClose = false;

  status: ConnStatus = "idle";
  detail = "";
  hello: any = null;

  private urls(): string[] {
    const direct = env("VITE_GATEWAY_URL") || "ws://127.0.0.1:18789";
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const proxied = `${proto}://${location.host}/gateway-ws`;
    // 폰 등 원격(비 localhost) 접속이면 direct(127.0.0.1)는 상대 기기를 가리켜 실패하므로
    // 서버측 프록시를 먼저 시도해 12초 타임아웃 지연을 피한다.
    const host = location.hostname;
    const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
    return isLocal ? [direct, proxied] : [proxied, direct];
  }

  onEvent(fn: (f: EventFrame) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onStatus(fn: (s: ConnStatus, detail: string) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: ConnStatus, detail = "") {
    this.status = s;
    this.detail = detail;
    this.statusListeners.forEach((f) => f(s, detail));
  }

  async connect(): Promise<boolean> {
    if (this.status === "connected") return true;
    if (this.status === "connecting") return false;
    this.manualClose = false;
    for (const url of this.urls()) {
      const ok = await this.tryUrl(url).catch(() => false);
      if (ok) return true;
    }
    this.setStatus("error", "게이트웨이 연결 실패 — OpenClaw 게이트웨이가 켜져 있는지 확인하세요 (openclaw daemon status)");
    return false;
  }

  disconnect() {
    this.manualClose = true;
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
  }

  private tryUrl(url: string): Promise<boolean> {
    this.setStatus("connecting", url);
    this.connectSent = false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let ws: WebSocket;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          try {
            ws?.close();
          } catch {
            /* noop */
          }
        }
        resolve(ok);
      };
      try {
        ws = new WebSocket(url);
      } catch {
        finish(false);
        return;
      }
      this.ws = ws;
      const connectTimer = setTimeout(() => finish(false), CONNECT_TIMEOUT);
      // 일부 구현은 challenge 이벤트 없이 바로 connect 요청을 기대할 수 있어
      // 잠시 기다렸다가 선제적으로 전송한다.
      const preemptive = setTimeout(() => this.sendConnect(), 1500);
      this.connectResolve = (ok) => {
        clearTimeout(connectTimer);
        clearTimeout(preemptive);
        if (ok) this.setStatus("connected", url);
        finish(ok);
      };
      ws.onmessage = (m) => this.handleMessage(m);
      ws.onclose = () => {
        clearTimeout(connectTimer);
        clearTimeout(preemptive);
        const wasConnected = this.status === "connected";
        this.failAllPending("게이트웨이 연결이 끊어졌습니다");
        this.setStatus("closed");
        finish(false);
        if (wasConnected && !this.manualClose) {
          setTimeout(() => void this.connect(), 2500);
        }
      };
    });
  }

  private sendConnect() {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.connectSent = true;
    const id = `connect-${++this.seq}`;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.connectResolve?.(false);
      this.connectResolve = null;
    }, CONNECT_TIMEOUT);
    this.pending.set(id, {
      resolve: (payload) => {
        clearTimeout(timer);
        this.hello = payload;
        this.connectResolve?.(true);
        this.connectResolve = null;
      },
      reject: (e) => {
        clearTimeout(timer);
        this.detail = e.message;
        console.warn("[gateway] connect 거부:", e.message);
        this.connectResolve?.(false);
        this.connectResolve = null;
      },
      timer,
    });
    this.ws.send(
      JSON.stringify({
        type: "req",
        id,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 4,
          // client.id / client.mode 는 게이트웨이 enum 검증 대상 — CLI와 동일 신원 사용
          client: { id: "cli", version: "0.1.0", platform: "web", mode: "cli" },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          auth: { token: env("VITE_GATEWAY_TOKEN") },
          locale: "ko-KR",
        },
      })
    );
  }

  private handleMessage(m: MessageEvent) {
    let frame: any;
    try {
      frame = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (frame?.type === "res") {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      if (frame.ok === false || frame.error) {
        const msg =
          frame.error?.message ??
          (typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error ?? "요청 실패"));
        p.reject(new Error(msg));
      } else {
        p.resolve(frame.payload);
      }
      return;
    }
    if (frame?.type === "event") {
      if (frame.event === "connect.challenge") {
        this.sendConnect();
        return;
      }
      this.eventListeners.forEach((f) => f(frame as EventFrame));
    }
  }

  private failAllPending(msg: string) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(msg));
    }
    this.pending.clear();
  }

  request(method: string, params: any, timeoutMs = DEFAULT_REQ_TIMEOUT): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== "connected") {
        reject(new Error("게이트웨이에 연결되어 있지 않습니다"));
        return;
      }
      const id = `${method}-${Date.now()}-${++this.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 요청 시간 초과 (${Math.round(timeoutMs / 1000)}초)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  /** res 페이로드에서 최종 텍스트/사용량을 방어적으로 추출 */
  private parseRunPayload(payload: any): RunResult {
    const root = payload?.result ?? payload ?? {};
    const payloads = root?.payloads ?? payload?.payloads ?? [];
    const text = (Array.isArray(payloads) ? payloads : [])
      .map((p: any) => p?.text ?? "")
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const usage: RunUsage | undefined = root?.meta?.agentMeta?.usage ?? undefined;
    return { text, usage, raw: payload };
  }

  /**
   * 에이전트 1턴 실행 — 완료까지 대기하고 최종 텍스트를 반환.
   *
   * 게이트웨이 WS의 실행 메서드(operator.write)는 디바이스 페어링(Ed25519 서명)이
   * 필요해 브라우저에서 직접 호출할 수 없다. 대신 로컬 Vite 미들웨어(/api/agent)가
   * 디바이스 신원을 자동 처리하는 공식 CLI를 실행해 결과를 돌려준다.
   * (WS 연결은 상태 표시·이벤트 수신용으로 계속 사용)
   */
  async runAgent(agentId: string, input: string, sessionSuffix: string, signal?: AbortSignal): Promise<RunResult> {
    const r = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 중단 시그널 — 요청이 끊기면 서버측 브리지가 CLI 프로세스를 즉시 종료한다
      signal,
      body: JSON.stringify({
        agentId,
        message: input,
        sessionKey: `agent:${agentId}:${sessionSuffix}`,
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `에이전트 실행 실패 (HTTP ${r.status})`);
    const payload = j.run;
    const parsed = this.parseRunPayload(payload);
    if (!parsed.text) {
      const status = payload?.status ?? payload?.result?.status;
      if (status && status !== "ok") throw new Error(payload?.summary || "에이전트 실행 실패");
      parsed.text = "(빈 응답)";
    }
    return parsed;
  }

  /** 채팅 전송 — 브리지 실행(최종 텍스트 일괄 수신). WS chat 이벤트가 오면 UI가 추가로 반영. */
  async sendChat(
    agentId: string,
    text: string,
    sessionSuffix: string
  ): Promise<{ streamed: boolean; result?: RunResult }> {
    const result = await this.runAgent(agentId, text, sessionSuffix);
    return { streamed: false, result };
  }

  /** 게이트웨이에 등록된 에이전트 목록 (실패해도 무해 — 정적 목록으로 폴백) */
  async listAgents(): Promise<any[]> {
    try {
      const payload = await this.request("agents.list", {}, 15_000);
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload?.agents)) return payload.agents;
      return [];
    } catch {
      return [];
    }
  }
}

export const gateway = new GatewayClient();
