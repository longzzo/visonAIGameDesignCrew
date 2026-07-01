// Vision Engine 전역 상태 (zustand) — 게이트웨이 연결, 프로젝트, 채팅, 오케스트레이션, GDD

import { create } from "zustand";
import { gateway, type EventFrame, type RunUsage } from "./lib/gateway";
import {
  AGENTS,
  AGENT_MAP,
  SPECIALISTS,
  specialistPrompt,
  pmSummaryPrompt,
  type AgentDef,
} from "./lib/agents";
import {
  fetchGdd,
  saveGdd,
  replaceSection,
  sanitizeAgentOutput,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  type ProjectInfo,
} from "./lib/gdd";

export type View = "orch" | "chat";
export type MobilePanel = "agents" | "work" | "gdd";
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
  /** PM이 이 에이전트에게 보낸 지시 전문 (자연어) */
  instruction?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  reflected?: boolean;
}

export interface AgentHealth {
  ok: boolean;
  ms: number;
  reply?: string;
  error?: string;
}

export interface UsageTotals {
  input: number;
  output: number;
  calls: number;
  estimated: boolean;
}

interface VEState {
  view: View;
  mobilePanel: MobilePanel;
  conn: string;
  connDetail: string;
  modelName: string;
  agentStatus: Record<string, AgentStatus>;

  projects: ProjectInfo[];
  activeProject: string;

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

  agentHealth: Record<string, AgentHealth>;
  healthRunning: boolean;

  gdd: string;
  gddMtime: number;
  gddEditing: boolean;
  gddDraft: string;
  gddSaving: boolean;

  usage: UsageTotals;

  init: () => Promise<void>;
  reconnect: () => Promise<void>;
  setView: (v: View) => void;
  setMobilePanel: (p: MobilePanel) => void;
  selectAgent: (id: string) => void;

  loadProjects: () => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;
  createProjectAction: (name: string) => Promise<void>;
  renameProjectAction: (name: string) => Promise<void>;
  deleteProjectAction: (id: string) => Promise<void>;

  sendChat: (text: string) => Promise<void>;
  newChatSession: (id: string) => void;

  setOrchRequest: (t: string) => void;
  toggleSelected: (id: string) => void;
  setConcurrency: (n: number) => void;
  setAutoReflect: (b: boolean) => void;
  startOrch: () => Promise<void>;
  stopOrch: () => void;

  healthCheck: () => Promise<void>;

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
    mobilePanel: "work",
    conn: "idle",
    connDetail: "",
    modelName: ((import.meta as any).env?.VITE_DEFAULT_MODEL as string) || "ollama/qwen3:8b",
    agentStatus: {},

    projects: [],
    activeProject: "",

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

    agentHealth: {},
    healthRunning: false,

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
      await get().loadProjects();
      void get().loadGdd();
      setInterval(() => {
        const st = get();
        if (!st.gddEditing && !st.gddSaving && st.activeProject) void st.loadGdd();
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
    setMobilePanel: (p) => set({ mobilePanel: p }),
    selectAgent: (id) => set({ activeAgent: id, view: "chat", mobilePanel: "work" }),

    /* ── 프로젝트 ─────────────────────────────────── */

    loadProjects: async () => {
      try {
        let projects = await listProjects();
        if (projects.length === 0) {
          const id = await createProject("새 게임 프로젝트");
          projects = await listProjects();
          set({ activeProject: id });
        }
        const stored = localStorage.getItem("ve-active-project") ?? "";
        const active =
          get().activeProject && projects.some((p) => p.id === get().activeProject)
            ? get().activeProject
            : projects.some((p) => p.id === stored)
              ? stored
              : projects[0]?.id ?? "";
        set({ projects, activeProject: active });
        localStorage.setItem("ve-active-project", active);
      } catch (e) {
        console.warn("[projects] 목록 로드 실패:", e);
      }
    },

    setActiveProject: async (id) => {
      if (id === get().activeProject) return;
      localStorage.setItem("ve-active-project", id);
      // 프로젝트별로 대화 컨텍스트를 분리한다 (세션 키에 프로젝트 id 포함).
      // 화면의 채팅·카드도 프로젝트 전환 시 초기화한다.
      set({
        activeProject: id,
        chats: {},
        chatBusy: {},
        cards: {},
        orchLog: [],
        agentStatus: {},
        gdd: "",
        gddMtime: 0,
        gddEditing: false,
      });
      await get().loadGdd();
    },

    createProjectAction: async (name) => {
      const id = await createProject(name);
      await get().loadProjects();
      await get().setActiveProject(id);
    },

    renameProjectAction: async (name) => {
      const id = get().activeProject;
      if (!id) return;
      await renameProject(id, name);
      await get().loadProjects();
    },

    deleteProjectAction: async (id) => {
      await deleteProject(id);
      localStorage.removeItem("ve-active-project");
      set({ activeProject: "" });
      await get().loadProjects();
      await get().loadGdd();
    },

    /* ── 채팅 ─────────────────────────────────────── */

    sendChat: async (text) => {
      const id = get().activeAgent;
      if (get().chatBusy[id]) return;
      const project = get().activeProject || "np";
      const epoch = get().chatEpoch[id] ?? 1;
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text, ts: Date.now() };
      set((s) => ({
        chats: { ...s.chats, [id]: [...(s.chats[id] ?? []), userMsg] },
        chatBusy: { ...s.chatBusy, [id]: true },
      }));
      setAgentStatus(id, "running");
      try {
        const { result } = await gateway.sendChat(id, text, `web-${project}-${epoch}`);
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

    /* ── 오케스트레이션 ───────────────────────────── */

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
      const project = st.activeProject || "np";
      const runTag = `${project}-orch-${Date.now().toString(36)}`;

      const initialCards: Record<string, OrchCard> = Object.fromEntries(
        targets.map((a) => [a.id, { agentId: a.id, state: "queued" as const, output: "" }])
      );
      initialCards["pm"] = { agentId: "pm", state: "pending", output: "" };
      set({ orchRunning: true, stopRequested: false, cards: initialCards, orchLog: [] });
      log(`🎯 PM: 요청 접수 — "${req.slice(0, 60)}${req.length > 60 ? "…" : ""}"`);
      log(`🎯 PM: ${targets.map((a) => a.name).join(", ")}에게 작업 분배 (동시 실행 ${st.concurrency})`);

      const queue = [...targets];
      const results: { agent: AgentDef; text: string }[] = [];

      const worker = async () => {
        while (queue.length > 0) {
          if (get().stopRequested) return;
          const agent = queue.shift();
          if (!agent) return;
          const instruction = specialistPrompt(req, agent);
          updateCard(agent.id, { state: "running", startedAt: Date.now(), instruction });
          setAgentStatus(agent.id, "running");
          log(`🎯 PM → ${agent.emoji} ${agent.name}: "${agent.sectionTitle}" 파트 작성 지시 (지시 전문은 카드에서)`);
          try {
            const r = await gateway.runAgent(agent.id, instruction, runTag);
            const clean = sanitizeAgentOutput(r.text);
            addUsage(r.usage, clean);
            updateCard(agent.id, { state: "done", output: clean, endedAt: Date.now() });
            setAgentStatus(agent.id, "done");
            results.push({ agent, text: clean });
            log(`${agent.emoji} ${agent.name} → 🎯 PM: "${agent.sectionTitle}" 초안 제출 (${clean.length}자)`);
            if (get().autoReflect) {
              await get().reflectToGdd(agent.id, clean);
              updateCard(agent.id, { reflected: true });
              log(`📄 GDD: "${agent.sectionTitle}" 섹션 갱신됨`);
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

      if (results.length > 0) {
        const pm = AGENT_MAP["pm"];
        const pmInstruction = pmSummaryPrompt(req, results);
        updateCard("pm", { state: "running", startedAt: Date.now(), instruction: pmInstruction });
        setAgentStatus("pm", "running");
        log(`🎯 PM: 산출물 ${results.length}건 취합 — 개요 통합 작성 시작`);
        try {
          const r = await gateway.runAgent("pm", pmInstruction, runTag);
          const clean = sanitizeAgentOutput(r.text);
          addUsage(r.usage, clean);
          updateCard("pm", { state: "done", output: clean, endedAt: Date.now() });
          setAgentStatus("pm", "done");
          if (get().autoReflect) {
            await get().reflectToGdd("pm", clean);
            updateCard("pm", { reflected: true });
          }
          log(`${pm.emoji} PM: 개요 통합 완료 — GDD 갱신됨`);
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

    /* ── 에이전트 헬스체크 (8명 전원 실행 확인) ────── */

    healthCheck: async () => {
      if (get().healthRunning) return;
      set({ healthRunning: true, agentHealth: {} });
      const tag = `health-${Date.now().toString(36)}`;
      const queue = [...AGENTS];
      const worker = async () => {
        while (queue.length > 0) {
          const a = queue.shift();
          if (!a) return;
          const t0 = Date.now();
          setAgentStatus(a.id, "running");
          try {
            // "상태 점검" 같은 표현은 모델이 세션 조회 도구를 호출하게 만들어(컨텍스트 폭증)
            // 응답이 크게 느려진다 — 도구 금지를 명시한 단순 에코 요청으로 유지할 것.
            const r = await gateway.runAgent(
              a.id,
              "단순 연결 테스트다. 어떤 도구도 사용하지 말고 다른 행동 없이 '이상 없음'만 출력해라.",
              tag
            );
            set((s) => ({
              agentHealth: {
                ...s.agentHealth,
                [a.id]: { ok: true, ms: Date.now() - t0, reply: r.text.slice(0, 40) },
              },
            }));
            setAgentStatus(a.id, "done");
          } catch (e: any) {
            set((s) => ({
              agentHealth: {
                ...s.agentHealth,
                [a.id]: { ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 120) },
              },
            }));
            setAgentStatus(a.id, "error");
          }
        }
      };
      await Promise.all([worker(), worker()]); // 동시 2
      set({ healthRunning: false });
    },

    /* ── GDD ─────────────────────────────────────── */

    reflectToGdd: async (agentId, text) => {
      const agent = AGENT_MAP[agentId];
      const project = get().activeProject;
      if (!agent || !project) return;
      gddQueue = gddQueue.then(async () => {
        try {
          const cur = await fetchGdd(project);
          const md = replaceSection(cur.markdown, agent.section, agent.sectionTitle, text);
          const mtime = await saveGdd(project, md);
          set({ gdd: md, gddMtime: mtime });
        } catch (e) {
          console.warn("[gdd] 반영 실패:", e);
        }
      });
      await gddQueue;
    },

    loadGdd: async () => {
      const project = get().activeProject;
      if (!project) return;
      try {
        const { markdown, mtime } = await fetchGdd(project);
        if (mtime !== get().gddMtime) set({ gdd: markdown, gddMtime: mtime });
      } catch {
        /* dev 서버 미들웨어 없으면 무시 */
      }
    },

    setGddEditing: (b) => set((s) => ({ gddEditing: b, gddDraft: b ? s.gdd : s.gddDraft })),
    setGddDraft: (t) => set({ gddDraft: t }),
    saveGddDraft: async () => {
      const project = get().activeProject;
      if (!project) return;
      set({ gddSaving: true });
      try {
        const mtime = await saveGdd(project, get().gddDraft);
        set({ gdd: get().gddDraft, gddMtime: mtime, gddEditing: false });
      } finally {
        set({ gddSaving: false });
      }
    },
  };
});
