// OpenClaw 게이트웨이 브라우저 클라이언트.
// 인증 토큰은 서버의 gateway-relay에만 있고, 브라우저는 제한된 SSE 이벤트만 받는다.

import { loadGuard } from "./cost";
import { skillDirective } from "./growth";
import { tempDirective } from "./tuning";

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

const CONNECT_TIMEOUT = 12_000;

export class GatewayClient {
  private events: EventSource | null = null;
  private eventListeners = new Set<(f: EventFrame) => void>();
  private statusListeners = new Set<(s: ConnStatus, detail: string) => void>();
  /** 에이전트 실행 실패 알림 — 크레딧 소진 등 반복 오류 감지용 */
  private runErrorListeners = new Set<(msg: string) => void>();
  status: ConnStatus = "idle";
  detail = "";
  private runtimeMode: "subscription" | "openclaw" = "openclaw";

  onEvent(fn: (f: EventFrame) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onStatus(fn: (s: ConnStatus, detail: string) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onRunError(fn: (msg: string) => void): () => void {
    this.runErrorListeners.add(fn);
    return () => this.runErrorListeners.delete(fn);
  }

  private setStatus(s: ConnStatus, detail = "") {
    this.status = s;
    this.detail = detail;
    this.statusListeners.forEach((f) => f(s, detail));
  }

  async connect(): Promise<boolean> {
    if (this.status === "connected") return true;
    this.setStatus("connecting", "AI 실행 경로 확인 중");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    try {
      const readiness = await fetch("/api/readiness", { signal: controller.signal, cache: "no-store" }).then((r) => r.json());
      this.runtimeMode = readiness?.aiRuntime === "subscription" ? "subscription" : "openclaw";
      if (this.runtimeMode === "subscription") {
        this.events?.close();
        this.events = null;
        const providers = [readiness?.claude?.subscription && "Claude", readiness?.codex?.subscription && "Codex"].filter(Boolean);
        const local = readiness?.ollama?.running && readiness?.ollama?.recommendedInstalled;
        const ok = providers.length > 0 || !!local;
        const detail = providers.length
          ? `${providers.join(" · ")} 구독 연결됨${local ? " · 로컬 폴백 준비" : ""}`
          : local
            ? "구독 미로그인 · 로컬 Ollama 폴백 준비"
            : "Claude/Codex 구독 로그인 또는 로컬 Ollama가 필요합니다";
        this.setStatus(ok ? "connected" : "error", detail);
        return ok;
      }
    } catch {
      // 구버전/원격 서버에서 readiness를 못 읽으면 기존 OpenClaw 릴레이 점검을 계속한다.
      this.runtimeMode = "openclaw";
    } finally {
      clearTimeout(timer);
    }
    if (!this.events) {
      const events = new EventSource("/api/gateway/events");
      this.events = events;
      events.onmessage = (message) => {
        try {
          const frame = JSON.parse(message.data) as EventFrame;
          if (frame.event === "gateway.status") {
            const connected = !!frame.payload?.connected;
            this.setStatus(connected ? "connected" : "closed", String(frame.payload?.detail ?? ""));
            return;
          }
          this.eventListeners.forEach((listener) => listener(frame));
        } catch {
          /* 잘못된 릴레이 프레임은 무시 */
        }
      };
      events.onerror = () => {
        if (this.runtimeMode === "openclaw") this.setStatus("closed", "게이트웨이 이벤트 릴레이 연결이 끊겼습니다");
      };
    }
    const gatewayController = new AbortController();
    const gatewayTimer = setTimeout(() => gatewayController.abort(), CONNECT_TIMEOUT);
    try {
      const response = await fetch("/api/gateway/status", { signal: gatewayController.signal });
      const result = await response.json();
      const ok = !!result?.connected;
      this.setStatus(ok ? "connected" : "error", String(result?.detail ?? "게이트웨이 연결 실패"));
      return ok;
    } catch {
      this.setStatus("error", "Vision Engine 서버의 게이트웨이 릴레이에 연결할 수 없습니다");
      return false;
    } finally {
      clearTimeout(gatewayTimer);
    }
  }

  disconnect() {
    this.events?.close();
    this.events = null;
    this.setStatus("closed");
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
  /* ── 비용 가드 — 10분 윈도 호출 수 상한 (무한 반복 폭주 차단) ── */
  private callTimes: number[] = [];
  private costGuardListeners = new Set<(msg: string) => void>();
  onCostGuard(fn: (msg: string) => void): () => void {
    this.costGuardListeners.add(fn);
    return () => this.costGuardListeners.delete(fn);
  }
  /** 최근 10분간 LLM 호출 수 (사용량 패널 표시용) */
  callsIn10Min(): number {
    const cut = Date.now() - 600_000;
    this.callTimes = this.callTimes.filter((t) => t > cut);
    return this.callTimes.length;
  }
  private checkCostGuard() {
    const g = loadGuard();
    if (!g.enabled) return;
    if (this.callsIn10Min() >= g.maxPer10Min) {
      const msg = `🛑 비용 가드 — 10분당 LLM 호출 한도(${g.maxPer10Min}회)를 넘었습니다. 에이전트가 같은 작업을 반복하고 있을 수 있어 호출을 차단했습니다. 상단 🪙 배지에서 한도를 조절하거나 잠시 후 다시 시도하세요.`;
      this.costGuardListeners.forEach((f) => f(msg));
      throw new Error(msg);
    }
  }

  async runAgent(
    agentId: string,
    input: string,
    sessionSuffix: string,
    signal?: AbortSignal,
    model?: string
  ): Promise<RunResult> {
    this.checkCostGuard();
    this.callTimes.push(Date.now());
    // 창의성(온도) 튜닝 + 자가 학습 요령(스킬) — 모든 작업 프롬프트 앞에 주입
    input = tempDirective(agentId) + skillDirective(agentId) + input;
    const r = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 중단 시그널 — 요청이 끊기면 서버측 브리지가 CLI 프로세스를 즉시 종료한다
      signal,
      body: JSON.stringify({
        agentId,
        message: input,
        sessionKey: `agent:${agentId}:${sessionSuffix}`,
        // 이 호출만 다른 모델로 (예: 발표 생성 = gpt-oss-120b). 없으면 에이전트 기본.
        ...(model ? { model } : {}),
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      const msg = j?.error || `에이전트 실행 실패 (HTTP ${r.status})`;
      this.runErrorListeners.forEach((f) => f(msg));
      throw new Error(msg);
    }
    const payload = j.run;
    const parsed = this.parseRunPayload(payload);
    if (!parsed.text) {
      const status = payload?.status ?? payload?.result?.status;
      if (status && status !== "ok") {
        const msg = payload?.summary || "에이전트 실행 실패";
        this.runErrorListeners.forEach((f) => f(String(msg)));
        throw new Error(msg);
      }
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
      const response = await fetch("/api/gateway/agents");
      const payload = await response.json();
      return Array.isArray(payload?.agents) ? payload.agents : [];
    } catch {
      return [];
    }
  }
}

export const gateway = new GatewayClient();
