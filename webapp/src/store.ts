// Vision Engine 전역 상태 (zustand)
// 게이트웨이 연결 · 프로젝트 · 채팅(영속) · 오케스트레이션 대화 피드(영속) · 교차 검토 루프 · GDD(버전 히스토리)

import { create } from "zustand";
import { gateway, type EventFrame, type RunUsage } from "./lib/gateway";
import {
  AGENTS,
  AGENT_MAP,
  SPECIALISTS,
  REVIEWERS,
  specialistPrompt,
  reviewPrompt,
  revisePrompt,
  pmSummaryPrompt,
  pmVerifyPrompt,
  type AgentDef,
} from "./lib/agents";
import {
  fetchGdd,
  saveGdd,
  replaceSection,
  getSectionBody,
  sanitizeAgentOutput,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  listGddVersions,
  fetchGddVersion,
  restoreGddVersion,
  loadChatHistory,
  saveChatHistory,
  loadFeedHistory,
  saveFeedHistory,
  type ProjectInfo,
  type GddVersion,
} from "./lib/gdd";

export type View = "orch" | "chat" | "office";
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

/** 오케스트레이션 대화 피드의 말풍선 하나 — 에이전트들이 주고받는 자연어 메시지 */
export interface FeedMsg {
  id: string;
  from: string; // agentId | "user" | "system"
  to?: string; // agentId
  kind: "request" | "instruction" | "draft" | "review" | "revision" | "summary" | "status" | "error";
  text: string;
  ts: number;
}

export interface OrchCard {
  agentId: string;
  state: "pending" | "queued" | "running" | "done" | "error";
  /** 진행 단계 설명 (초안 작성 중 / OO 검토 중 / 검토 반영 수정 중) */
  phase?: string;
  output: string;
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

/** 1:1 대화 결론에 대한 PM 검증 대기 상태 */
export interface PendingVerify {
  status: "running" | "ready" | "error";
  verdict?: string;
  finalText?: string;
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
  pendingVerify: Record<string, PendingVerify | undefined>;

  orchRequest: string;
  selected: Record<string, boolean>;
  concurrency: number;
  autoReflect: boolean;
  crossReview: boolean;
  webResearch: boolean;
  orchRunning: boolean;
  stopRequested: boolean;
  cards: Record<string, OrchCard>;
  feed: FeedMsg[];

  agentHealth: Record<string, AgentHealth>;
  healthRunning: boolean;

  gdd: string;
  gddMtime: number;
  gddEditing: boolean;
  gddDraft: string;
  gddSaving: boolean;
  gddVersions: GddVersion[];
  gddPreview: { ts: number; markdown: string } | null;

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
  /** 1:1 대화의 마지막 결론을 PM에게 검증 요청 */
  requestPmVerify: (agentId: string) => Promise<void>;
  /** 오너 승인 — 반영안(직전 버전은 자동 백업됨)을 GDD에 적용 */
  approveVerify: (agentId: string) => Promise<void>;
  rejectVerify: (agentId: string) => void;

  setOrchRequest: (t: string) => void;
  toggleSelected: (id: string) => void;
  setConcurrency: (n: number) => void;
  setAutoReflect: (b: boolean) => void;
  setCrossReview: (b: boolean) => void;
  setWebResearch: (b: boolean) => void;
  startOrch: () => Promise<void>;
  stopOrch: () => void;
  clearFeed: () => void;
  /** 풀 기획 회의 — 7명 전체 + 교차 검토 + GDD 반영을 구성하고 요청이 있으면 즉시 시작 */
  fullMeeting: () => Promise<void>;

  healthCheck: () => Promise<void>;

  reflectToGdd: (agentId: string, text: string) => Promise<void>;
  loadGdd: () => Promise<void>;
  setGddEditing: (b: boolean) => void;
  setGddDraft: (t: string) => void;
  saveGddDraft: () => Promise<void>;
  loadGddVersions: () => Promise<void>;
  previewGddVersion: (ts: number) => Promise<void>;
  closeGddPreview: () => void;
  restoreGdd: (ts: number) => Promise<void>;
}

let initialized = false;
let gddQueue: Promise<void> = Promise.resolve();
let persistQueue: Promise<void> = Promise.resolve();
let feedSeq = 0;
const loadedChats = new Set<string>(); // `${project}:${agent}`

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 2.5));
}

export const useVE = create<VEState>()((set, get) => {
  const setAgentStatus = (id: string, st: AgentStatus) =>
    set((s) => ({ agentStatus: { ...s.agentStatus, [id]: st } }));

  const updateCard = (id: string, patch: Partial<OrchCard>) =>
    set((s) => ({
      cards: { ...s.cards, [id]: { ...(s.cards[id] ?? { agentId: id, state: "pending", output: "" }), ...patch } },
    }));

  /** 피드에 말풍선 추가 + 서버 저장(직렬화) */
  const pushFeed = (msg: Omit<FeedMsg, "id" | "ts">) => {
    const full: FeedMsg = { ...msg, id: `f-${Date.now()}-${++feedSeq}`, ts: Date.now() };
    set((s) => ({ feed: [...s.feed.slice(-399), full] }));
    const project = get().activeProject;
    if (project) {
      persistQueue = persistQueue.then(() => saveFeedHistory(project, get().feed));
    }
  };

  /** 채팅 저장(직렬화) */
  const persistChat = (agentId: string) => {
    const project = get().activeProject;
    if (!project) return;
    const messages = (get().chats[agentId] ?? []).map((m) => ({ ...m, streaming: false }));
    persistQueue = persistQueue.then(() => saveChatHistory(project, agentId, messages));
  };

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
        usage: { input: s.usage.input, output: s.usage.output + est, calls: s.usage.calls + 1, estimated: true },
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

  /** 프로젝트의 저장된 채팅을 (아직 안 불렀으면) 불러온다 */
  const ensureChatLoaded = async (agentId: string) => {
    const project = get().activeProject;
    if (!project) return;
    const key = `${project}:${agentId}`;
    if (loadedChats.has(key)) return;
    loadedChats.add(key);
    const messages = await loadChatHistory(project, agentId);
    if (messages.length > 0 && (get().chats[agentId] ?? []).length === 0 && get().activeProject === project) {
      set((s) => ({ chats: { ...s.chats, [agentId]: messages } }));
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
    pendingVerify: {},

    orchRequest: "",
    selected: Object.fromEntries(SPECIALISTS.map((a) => [a.id, true])),
    concurrency: 1,
    autoReflect: true,
    crossReview: true,
    webResearch: false,
    orchRunning: false,
    stopRequested: false,
    cards: {},
    feed: [],

    agentHealth: {},
    healthRunning: false,

    gdd: "",
    gddMtime: 0,
    gddEditing: false,
    gddDraft: "",
    gddSaving: false,
    gddVersions: [],
    gddPreview: null,

    usage: { input: 0, output: 0, calls: 0, estimated: false },

    init: async () => {
      if (initialized) return;
      initialized = true;
      gateway.onStatus((s, detail) => set({ conn: s, connDetail: detail }));
      gateway.onEvent(handleEvent);
      await get().loadProjects();
      void get().loadGdd();
      // 저장된 피드/기본 에이전트 채팅 복원
      const project = get().activeProject;
      if (project) {
        const feed = await loadFeedHistory(project);
        if (feed.length > 0 && get().activeProject === project) set({ feed });
        void ensureChatLoaded(get().activeAgent);
      }
      setInterval(() => {
        const st = get();
        if (!st.gddEditing && !st.gddSaving && !st.gddPreview && st.activeProject) void st.loadGdd();
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
    selectAgent: (id) => {
      set({ activeAgent: id, view: "chat", mobilePanel: "work" });
      void ensureChatLoaded(id);
    },

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
      set({
        activeProject: id,
        chats: {},
        chatBusy: {},
        cards: {},
        feed: [],
        agentStatus: {},
        gdd: "",
        gddMtime: 0,
        gddEditing: false,
        gddVersions: [],
        gddPreview: null,
      });
      await get().loadGdd();
      const feed = await loadFeedHistory(id);
      if (get().activeProject === id && feed.length > 0) set({ feed });
      void ensureChatLoaded(get().activeAgent);
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
      set({ activeProject: "", feed: [], chats: {} });
      await get().loadProjects();
      await get().loadGdd();
    },

    /* ── 채팅 (프로젝트별 서버 저장) ───────────────── */

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
        persistChat(id);
      }
    },

    newChatSession: (id) => {
      set((s) => ({
        chatEpoch: { ...s.chatEpoch, [id]: (s.chatEpoch[id] ?? 1) + 1 },
        chats: { ...s.chats, [id]: [] },
        pendingVerify: { ...s.pendingVerify, [id]: undefined },
      }));
      persistChat(id);
    },

    /* ── 1:1 대화 → PM 검증 → 오너 승인 → GDD 반영 ── */

    requestPmVerify: async (agentId) => {
      const agent = AGENT_MAP[agentId];
      const project = get().activeProject;
      if (!agent || !project || get().pendingVerify[agentId]?.status === "running") return;
      const msgs = get().chats[agentId] ?? [];
      const proposal = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error && m.text.trim());
      if (!proposal) return;
      set((s) => ({ pendingVerify: { ...s.pendingVerify, [agentId]: { status: "running" } } }));
      setAgentStatus("pm", "running");
      try {
        const cur = await fetchGdd(project);
        const section = getSectionBody(cur.markdown, agent.section);
        const overview = getSectionBody(cur.markdown, "## 1.");
        const r = await gateway.runAgent(
          "pm",
          pmVerifyPrompt(agent, proposal.text, section, overview),
          `verify-${project}-${Date.now().toString(36)}`
        );
        const full = sanitizeAgentOutput(r.text);
        addUsage(r.usage, full);
        // "### 반영안" 헤딩 기준으로 검증 의견과 반영 최종본을 분리
        const m = /###\s*반영안\s*\n?/.exec(full);
        const verdict = m ? full.slice(0, m.index).trim() : full;
        const finalText = m ? full.slice(m.index + m[0].length).trim() : proposal.text;
        set((s) => ({
          pendingVerify: { ...s.pendingVerify, [agentId]: { status: "ready", verdict, finalText } },
        }));
        setAgentStatus("pm", "done");
      } catch (e: any) {
        set((s) => ({
          pendingVerify: {
            ...s.pendingVerify,
            [agentId]: { status: "error", error: String(e?.message ?? e).slice(0, 150) },
          },
        }));
        setAgentStatus("pm", "error");
      }
    },

    approveVerify: async (agentId) => {
      const pv = get().pendingVerify[agentId];
      if (!pv || pv.status !== "ready" || !pv.finalText) return;
      // reflectToGdd → 저장 시 서버가 직전 버전을 자동 스냅샷(백업)한다
      await get().reflectToGdd(agentId, pv.finalText);
      set((s) => ({
        pendingVerify: { ...s.pendingVerify, [agentId]: undefined },
        chats: {
          ...s.chats,
          [agentId]: [
            ...(s.chats[agentId] ?? []),
            {
              id: `sys-${Date.now()}`,
              role: "assistant",
              text: `✅ 오너 승인 — "${AGENT_MAP[agentId]?.sectionTitle}" 섹션에 반영했습니다. 직전 버전은 GDD 패널의 🕘 히스토리에 백업되어 있어 언제든 복원할 수 있습니다.`,
              ts: Date.now(),
            },
          ],
        },
      }));
      persistChat(agentId);
    },

    rejectVerify: (agentId) =>
      set((s) => ({ pendingVerify: { ...s.pendingVerify, [agentId]: undefined } })),

    /* ── 오케스트레이션 (대화 피드 + 교차 검토 루프) ── */

    setOrchRequest: (t) => set({ orchRequest: t }),
    toggleSelected: (id) => set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } })),
    setConcurrency: (n) => set({ concurrency: n }),
    setAutoReflect: (b) => set({ autoReflect: b }),
    setCrossReview: (b) => set({ crossReview: b }),
    setWebResearch: (b) => set({ webResearch: b }),
    fullMeeting: async () => {
      set({
        selected: Object.fromEntries(SPECIALISTS.map((a) => [a.id, true])),
        crossReview: true,
        autoReflect: true,
      });
      if (get().orchRequest.trim() && !get().orchRunning) await get().startOrch();
    },
    clearFeed: () => {
      set({ feed: [] });
      const project = get().activeProject;
      if (project) persistQueue = persistQueue.then(() => saveFeedHistory(project, []));
    },

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
      set({ orchRunning: true, stopRequested: false, cards: initialCards });

      pushFeed({ from: "user", kind: "request", text: req });

      // 기획 보존 모드 — 현재 GDD를 읽어 각 에이전트에게 "기존 기획 + 새 지시" 컨텍스트로 전달
      let baseMd = get().gdd;
      try {
        baseMd = (await fetchGdd(project)).markdown;
      } catch {
        /* 저장본을 못 읽으면 화면의 최신 상태 사용 */
      }
      const overview = getSectionBody(baseMd, "## 1.");
      const hasExisting = targets.some((a) => getSectionBody(baseMd, a.section).length > 0);

      pushFeed({
        from: "pm",
        kind: "status",
        text: `지시를 접수했습니다. ${targets.map((a) => `${a.emoji} ${a.name}`).join(", ")}에게 분배합니다.${hasExisting ? " 기존 기획은 유지하고 지시사항만 반영합니다." : ""}${st.crossReview ? " 각 결과는 동료 검토를 거쳐 확정됩니다." : ""}`,
      });

      const queue = [...targets];
      const results: { agent: AgentDef; text: string }[] = [];

      const worker = async () => {
        while (queue.length > 0) {
          if (get().stopRequested) return;
          const agent = queue.shift();
          if (!agent) return;
          const instruction = specialistPrompt(
            req,
            agent,
            get().webResearch,
            getSectionBody(baseMd, agent.section),
            overview
          );
          updateCard(agent.id, { state: "running", phase: "초안 작성 중", startedAt: Date.now(), instruction });
          setAgentStatus(agent.id, "running");
          pushFeed({ from: "pm", to: agent.id, kind: "instruction", text: instruction });
          try {
            const r = await gateway.runAgent(agent.id, instruction, runTag);
            const draft = sanitizeAgentOutput(r.text);
            addUsage(r.usage, draft);
            pushFeed({ from: agent.id, to: "pm", kind: "draft", text: draft });

            let final = draft;
            const reviewerId = REVIEWERS[agent.id];
            if (get().crossReview && reviewerId && !get().stopRequested) {
              const reviewer = AGENT_MAP[reviewerId];
              try {
                updateCard(agent.id, { phase: `${reviewer.name} 검토 중` });
                setAgentStatus(reviewer.id, "running");
                pushFeed({
                  from: "pm",
                  to: reviewer.id,
                  kind: "status",
                  text: `${agent.name}의 "${agent.sectionTitle}" 초안 검토를 요청합니다.`,
                });
                const rv = await gateway.runAgent(reviewer.id, reviewPrompt(req, agent, reviewer, draft), `${runTag}-rv`);
                const review = sanitizeAgentOutput(rv.text);
                addUsage(rv.usage, review);
                pushFeed({ from: reviewer.id, to: agent.id, kind: "review", text: review });
                setAgentStatus(reviewer.id, "done");

                updateCard(agent.id, { phase: "검토 반영 수정 중" });
                setAgentStatus(agent.id, "running");
                const rev = await gateway.runAgent(agent.id, revisePrompt(agent, reviewer, review), runTag);
                const revised = sanitizeAgentOutput(rev.text);
                addUsage(rev.usage, revised);
                if (revised && revised.length > 30) final = revised;
                pushFeed({ from: agent.id, to: "pm", kind: "revision", text: final });
              } catch (e: any) {
                setAgentStatus(reviewerId, "error");
                pushFeed({
                  from: "system",
                  kind: "status",
                  text: `⚠️ ${AGENT_MAP[reviewerId].name} 검토 단계 실패 (${String(e?.message ?? e).slice(0, 80)}) — ${agent.name}의 초안을 그대로 사용합니다.`,
                });
              }
            }

            updateCard(agent.id, { state: "done", phase: undefined, output: final, endedAt: Date.now() });
            setAgentStatus(agent.id, "done");
            results.push({ agent, text: final });
            if (get().autoReflect) {
              await get().reflectToGdd(agent.id, final);
              updateCard(agent.id, { reflected: true });
              pushFeed({ from: "system", kind: "status", text: `📄 마스터 GDD "${agent.sectionTitle}" 섹션이 갱신되었습니다.` });
            }
          } catch (e: any) {
            updateCard(agent.id, { state: "error", phase: undefined, error: String(e?.message ?? e), endedAt: Date.now() });
            setAgentStatus(agent.id, "error");
            pushFeed({ from: "system", kind: "error", text: `⚠️ ${agent.name} 작업 실패: ${String(e?.message ?? e).slice(0, 120)}` });
          }
        }
      };

      const n = Math.max(1, Math.min(2, st.concurrency));
      await Promise.all(Array.from({ length: n }, () => worker()));

      if (get().stopRequested) {
        pushFeed({ from: "system", kind: "status", text: "사용자 요청으로 오케스트레이션이 중단되었습니다." });
        set({ orchRunning: false });
        return;
      }

      if (results.length > 0) {
        const pmInstruction = pmSummaryPrompt(req, results, overview);
        updateCard("pm", { state: "running", phase: "산출물 통합 중", startedAt: Date.now(), instruction: pmInstruction });
        setAgentStatus("pm", "running");
        pushFeed({ from: "pm", kind: "status", text: `산출물 ${results.length}건을 취합해 "1. 개요"를 통합 작성합니다.` });
        try {
          const r = await gateway.runAgent("pm", pmInstruction, runTag);
          const clean = sanitizeAgentOutput(r.text);
          addUsage(r.usage, clean);
          updateCard("pm", { state: "done", phase: undefined, output: clean, endedAt: Date.now() });
          setAgentStatus("pm", "done");
          pushFeed({ from: "pm", kind: "summary", text: clean });
          if (get().autoReflect) {
            await get().reflectToGdd("pm", clean);
            updateCard("pm", { reflected: true });
            pushFeed({ from: "system", kind: "status", text: `📄 마스터 GDD "개요" 섹션이 갱신되었습니다. 오케스트레이션 완료.` });
          }
        } catch (e: any) {
          updateCard("pm", { state: "error", phase: undefined, error: String(e?.message ?? e), endedAt: Date.now() });
          setAgentStatus("pm", "error");
          pushFeed({ from: "system", kind: "error", text: `⚠️ PM 통합 실패: ${String(e?.message ?? e).slice(0, 120)}` });
        }
      }
      set({ orchRunning: false });
    },

    stopOrch: () => {
      set({ stopRequested: true });
      pushFeed({ from: "system", kind: "status", text: "중단 요청됨 — 진행 중인 호출이 끝나는 대로 멈춥니다." });
    },

    /* ── 에이전트 헬스체크 ─────────────────────────── */

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
            // "상태 점검"류 표현은 모델이 세션 도구를 호출하게 만들어 컨텍스트가 폭증한다 — 에코 요청 유지
            const r = await gateway.runAgent(
              a.id,
              "단순 연결 테스트다. 어떤 도구도 사용하지 말고 다른 행동 없이 '이상 없음'만 출력해라.",
              tag
            );
            set((s) => ({
              agentHealth: { ...s.agentHealth, [a.id]: { ok: true, ms: Date.now() - t0, reply: r.text.slice(0, 40) } },
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
      await Promise.all([worker(), worker()]);
      set({ healthRunning: false });
    },

    /* ── GDD + 버전 히스토리 ───────────────────────── */

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
        /* noop */
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

    loadGddVersions: async () => {
      const project = get().activeProject;
      if (!project) return;
      const versions = await listGddVersions(project);
      set({ gddVersions: versions });
    },

    previewGddVersion: async (ts) => {
      const project = get().activeProject;
      if (!project) return;
      const markdown = await fetchGddVersion(project, ts);
      set({ gddPreview: { ts, markdown }, gddEditing: false });
    },

    closeGddPreview: () => set({ gddPreview: null }),

    restoreGdd: async (ts) => {
      const project = get().activeProject;
      if (!project) return;
      const { markdown, mtime } = await restoreGddVersion(project, ts);
      set({ gdd: markdown, gddMtime: mtime, gddPreview: null });
      await get().loadGddVersions();
    },
  };
});
