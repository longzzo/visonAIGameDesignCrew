// Vision Engine 전역 상태 (zustand) — 게이트웨이 연결, 채팅, 오케스트레이션, GDD

import { create } from "zustand";
import { gateway, type EventFrame, type RunUsage } from "./lib/gateway";
import {
  AGENT_MAP,
  SPECIALISTS,
  specialistPrompt,
  pmSummaryPrompt,
  type AgentDef,
} from "./lib/agents";
import { fetchGdd, saveGdd, replaceSection, sanitizeAgentOutput } from "./lib/gdd";

export type View = "orch" | "chat";
export type AgentStatus = "idle" | "running" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: boolean;
  ts: number;
}

export interface OrchCard {
  agentId: string;
  state: "pending" | "queued" | "running" | "done" | "error";
  output: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  reflected?: boolean;
}

export interface UsageTotals {
  input: number;
  output: number;
  calls: number;
  estimated: boolean;
}

interface VEState {
  view: View;
  conn: string;
  connDetail: string;
  projectName: string;
  modelName: string;
  agentStatus: Record<string, AgentStatus>;

  activeAgent: string;
  chats: Record<string, ChatMessage[]>;
  chatEpoch: Record<string, number>;
  chatBusy: Record<string, boolean>;

  orchRequest: string;
  selected: Record<string, boolean>;
  concurrency: number;
  autoReflect: boolean;
  orchRunning: boolean;
  stopRequested: boolean;
  cards: Record<string, OrchCard>;
  orchLog: string[];

  gdd: string;
  gddMtime: number;
  gddEditing: boolean;
  gddDraft: string;
  gddSaving: boolean;

  usage: UsageTotals;

  init: () => Promise<void>;
  reconnect: () => Promise<void>;
  setView: (v: View) => void;
  setProjectName: (n: string) => void;
  selectAgent: (id: string) => void;
  sendChat: (text: string) => Promise<void>;
  newChatSession: (id: string) => void;
  setOrchRequest: (t: string) => void;
  toggleSelected: (id: string) => void;
  setConcurrency: (n: number) => void;
  setAutoReflect: (b: boolean) => void;
  startOrch: () => Promise<void>;
  stopOrch: () => void;
  reflectToGdd: (agentId: string, text: string) => Promise<void>;
  loadGdd: () => Promise<void>;
  setGddEditing: (b: boolean) => void;
  setGddDraft: (t: string) => void;
  saveGddDraft: () => Promise<void>;
}

let initialized = false;
let gddQueue: Promise<void> = Promise.resolve();

function estimateTokens(text: string): number {
  // 한국어 대략 2.5자/토큰 가정 (표시용 추정치)
  return Math.max(1, Math.round(text.length / 2.5));
}

export const useVE = create<VEState>()((set, get) => {
  const log = (msg: string) => {
    const line = `${new Date().toLocaleTimeString("ko-KR", { hour12: false })}  ${msg}`;
    set((s) => ({ orchLog: [...s.orchLog.slice(-99), line] }));
  };

  const setAgentStatus = (id: string, st: AgentStatus) =>
    set((s) => ({ agentStatus: { ...s.agentStatus, [id]: st } }));

  const updateCard = (id: string, patch: Partial<OrchCard>) =>
    set((s) => ({
      cards: { ...s.cards, [id]: { ...(s.cards[id] ?? { agentId: id, state: "pending", output: "" }), ...patch } },
    }));

  const addUsage = (u: RunUsage | undefined, fallbackText?: string) =>
    set((s) => {
      if (u && (u.input || u.output)) {
        return {
          usage: {
            input: s.usage.input + (u.input ?? 0),
            output: s.usage.output + (u.output ?? 0),
            calls: s.usage.calls + 1,
            estimated: s.usage.estimated,
          },
        };
      }
      const est = fallbackText ? estimateTokens(fallbackText) : 0;
      return {
        usage: {
          input: s.usage.input,
          output: s.usage.output + est,
          calls: s.usage.calls + 1,
          estimated: true,
        },
      };
    });

  const handleEvent = (frame: EventFrame) => {
    const p = frame.payload ?? {};
    const sessionKey: string = p.sessionKey ?? "";
    const m = /^agent:([^:]+):(.*)$/.exec(sessionKey);
    if (!m) return;
    const [, agentId, suffix] = m;

    if (frame.event === "agent") {
      const state = String(p.state ?? "").toLowerCase();
      if (state.includes("error") || state.includes("fail")) setAgentStatus(agentId, "error");
      else if (["done", "completed", "stopped", "finished", "idle"].some((k) => state.includes(k)))
        setAgentStatus(agentId, "done");
      else if (state) setAgentStatus(agentId, "running");
      return;
    }

    if (frame.event === "chat") {
      // 사용자 에코/비스트리밍 이벤트 방어
      const role = String(p.role ?? p.direction ?? "assistant").toLowerCase();
      if (role.includes("user") || role.includes("inbound")) return;
      if (!suffix.startsWith("web-")) return;
      const delta: string = p.deltaText ?? "";
      const full: string | undefined = typeof p.message === "string" ? p.message : undefined;
      set((s) => {
        const msgs = [...(s.chats[agentId] ?? [])];
        let last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant" || !last.streaming) {
          last = { id: `live-${Date.now()}`, role: "assistant", text: "", streaming: true, ts: Date.now() };
          msgs.push(last);
        } else {
          last = { ...last };
          msgs[msgs.length - 1] = last;
        }
        last.text = full !== undefined ? full : last.text + delta;
        return { chats: { ...s.chats, [agentId]: msgs } };
      });
    }
  };

  return {
    view: "orch",
    conn: "idle",
    connDetail: "",
    projectName: localStorage.getItem("ve-project") || "새 게임 프로젝트",
    modelName: ((import.meta as any).env?.VITE_DEFAULT_MODEL as string) || "ollama/qwen3:8b",
    agentStatus: {},

    activeAgent: "pm",
    chats: {},
    chatEpoch: {},
    chatBusy: {},

    orchRequest: "",
    selected: Object.fromEntries(SPECIALISTS.map((a) => [a.id, true])),
    concurrency: 1,
    autoReflect: true,
    orchRunning: false,
    stopRequested: false,
    cards: {},
    orchLog: [],

    gdd: "",
    gddMtime: 0,
    gddEditing: false,
    gddDraft: "",
    gddSaving: false,

    usage: { input: 0, output: 0, calls: 0, estimated: false },

    init: async () => {
      if (initialized) return;
      initialized = true;
      gateway.onStatus((s, detail) => set({ conn: s, connDetail: detail }));
      gateway.onEvent(handleEvent);
      void get().loadGdd();
      setInterval(() => {
        const st = get();
        if (!st.gddEditing && !st.gddSaving) void st.loadGdd();
      }, 4000);
      const ok = await gateway.connect();
      if (ok) {
        const agents = await gateway.listAgents();
        const model = agents.find((a: any) => a?.model)?.model;
        if (typeof model === "string" && model) set({ modelName: model });
      }
    },

    reconnect: async () => {
      await gateway.connect();
    },

    setView: (v) => set({ view: v }),
    setProjectName: (n) => {
      localStorage.setItem("ve-project", n);
      set({ projectName: n });
    },
    selectAgent: (id) => set({ activeAgent: id, view: "chat" }),

    sendChat: async (text) => {
      const id = get().activeAgent;
      if (get().chatBusy[id]) return;
      const epoch = get().chatEpoch[id] ?? 1;
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text, ts: Date.now() };
      set((s) => ({
        chats: { ...s.chats, [id]: [...(s.chats[id] ?? []), userMsg] },
        chatBusy: { ...s.chatBusy, [id]: true },
      }));
      setAgentStatus(id, "running");
      try {
        const { result } = await gateway.sendChat(id, text, `web-${epoch}`);
        set((s) => {
          const msgs = [...(s.chats[id] ?? [])];
          let last = msgs[msgs.length - 1];
          const finalText = result?.text ? sanitizeAgentOutput(result.text) : undefined;
          if (last && last.role === "assistant" && last.streaming) {
            last = { ...last, streaming: false };
            if (finalText && finalText.length > last.text.length) last.text = finalText;
            if (!last.text) last.text = finalText ?? "(빈 응답)";
            msgs[msgs.length - 1] = last;
          } else if (finalText) {
            msgs.push({ id: `a-${Date.now()}`, role: "assistant", text: finalText, ts: Date.now() });
          }
          return { chats: { ...s.chats, [id]: msgs } };
        });
        addUsage(result?.usage, result?.text ?? "");
        setAgentStatus(id, "done");
      } catch (e: any) {
        set((s) => ({
          chats: {
            ...s.chats,
            [id]: [
              ...(s.chats[id] ?? []),
              { id: `e-${Date.now()}`, role: "assistant", text: `⚠️ ${e?.message ?? e}`, error: true, ts: Date.now() },
            ],
          },
        }));
        setAgentStatus(id, "error");
      } finally {
        set((s) => ({ chatBusy: { ...s.chatBusy, [id]: false } }));
      }
    },

    newChatSession: (id) =>
      set((s) => ({
        chatEpoch: { ...s.chatEpoch, [id]: (s.chatEpoch[id] ?? 1) + 1 },
        chats: { ...s.chats, [id]: [] },
      })),

    setOrchRequest: (t) => set({ orchRequest: t }),
    toggleSelected: (id) => set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } })),
    setConcurrency: (n) => set({ concurrency: n }),
    setAutoReflect: (b) => set({ autoReflect: b }),

    startOrch: async () => {
      const st = get();
      const req = st.orchRequest.trim();
      if (!req || st.orchRunning) return;
      const targets = SPECIALISTS.filter((a) => st.selected[a.id]);
      if (targets.length === 0) return;
      const runTag = `orch-${Date.now().toString(36)}`;

      const initialCards: Record<string, OrchCard> = Object.fromEntries(
        targets.map((a) => [a.id, { agentId: a.id, state: "queued" as const, output: "" }])
      );
      initialCards["pm"] = { agentId: "pm", state: "pending", output: "" };
      set({ orchRunning: true, stopRequested: false, cards: initialCards, orchLog: [] });
      log(`오케스트레이션 시작 — ${targets.length}개 에이전트, 동시 실행 ${st.concurrency}`);

      const queue = [...targets];
      const results: { agent: AgentDef; text: string }[] = [];

      const worker = async () => {
        while (queue.length > 0) {
          if (get().stopRequested) return;
          const agent = queue.shift();
          if (!agent) return;
          updateCard(agent.id, { state: "running", startedAt: Date.now() });
          setAgentStatus(agent.id, "running");
          log(`${agent.emoji} ${agent.name} 작업 시작`);
          try {
            const r = await gateway.runAgent(agent.id, specialistPrompt(req, agent), runTag);
            const clean = sanitizeAgentOutput(r.text);
            addUsage(r.usage, clean);
            updateCard(agent.id, { state: "done", output: clean, endedAt: Date.now() });
            setAgentStatus(agent.id, "done");
            results.push({ agent, text: clean });
            log(`${agent.emoji} ${agent.name} 완료 (${clean.length}자)`);
            if (get().autoReflect) {
              await get().reflectToGdd(agent.id, clean);
              updateCard(agent.id, { reflected: true });
            }
          } catch (e: any) {
            updateCard(agent.id, { state: "error", error: String(e?.message ?? e), endedAt: Date.now() });
            setAgentStatus(agent.id, "error");
            log(`⚠️ ${agent.name} 실패: ${e?.message ?? e}`);
          }
        }
      };

      const n = Math.max(1, Math.min(2, st.concurrency));
      await Promise.all(Array.from({ length: n }, () => worker()));

      if (get().stopRequested) {
        log("사용자 요청으로 중단됨");
        set({ orchRunning: false });
        return;
      }

      // PM 통합 단계
      if (results.length > 0) {
        const pm = AGENT_MAP["pm"];
        updateCard("pm", { state: "running", startedAt: Date.now() });
        setAgentStatus("pm", "running");
        log(`${pm.emoji} PM 통합(개요 작성) 시작`);
        try {
          const r = await gateway.runAgent("pm", pmSummaryPrompt(req, results), runTag);
          const clean = sanitizeAgentOutput(r.text);
          addUsage(r.usage, clean);
          updateCard("pm", { state: "done", output: clean, endedAt: Date.now() });
          setAgentStatus("pm", "done");
          if (get().autoReflect) {
            await get().reflectToGdd("pm", clean);
            updateCard("pm", { reflected: true });
          }
          log(`${pm.emoji} PM 통합 완료 — GDD 갱신됨`);
        } catch (e: any) {
          updateCard("pm", { state: "error", error: String(e?.message ?? e), endedAt: Date.now() });
          setAgentStatus("pm", "error");
          log(`⚠️ PM 통합 실패: ${e?.message ?? e}`);
        }
      }
      set({ orchRunning: false });
      log("오케스트레이션 종료");
    },

    stopOrch: () => {
      set({ stopRequested: true });
      log("중단 요청됨 — 진행 중인 호출이 끝나는 대로 멈춥니다");
    },

    reflectToGdd: async (agentId, text) => {
      const agent = AGENT_MAP[agentId];
      if (!agent) return;
      gddQueue = gddQueue.then(async () => {
        try {
          const cur = await fetchGdd();
          const md = replaceSection(cur.markdown, agent.section, agent.sectionTitle, text);
          const mtime = await saveGdd(md);
          set({ gdd: md, gddMtime: mtime });
        } catch (e) {
          console.warn("[gdd] 반영 실패:", e);
        }
      });
      await gddQueue;
    },

    loadGdd: async () => {
      try {
        const { markdown, mtime } = await fetchGdd();
        if (mtime !== get().gddMtime) set({ gdd: markdown, gddMtime: mtime });
      } catch {
        /* dev 서버 미들웨어 없으면 무시 */
      }
    },

    setGddEditing: (b) => set((s) => ({ gddEditing: b, gddDraft: b ? s.gdd : s.gddDraft })),
    setGddDraft: (t) => set({ gddDraft: t }),
    saveGddDraft: async () => {
      set({ gddSaving: true });
      try {
        const mtime = await saveGdd(get().gddDraft);
        set({ gdd: get().gddDraft, gddMtime: mtime, gddEditing: false });
      } finally {
        set({ gddSaving: false });
      }
    },
  };
});
