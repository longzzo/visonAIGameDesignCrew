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
  pmRoutePrompt,
  parseRoutePlan,
  reportPrompt,
  reportVerifyPrompt,
  sdPromptPrompt,
  parseSdPrompt,
  officeBgSdPrompt,
  briefingPrompt,
  knowledgeVerifyPrompt,
  parseKnowledgeVerdict,
  collabPrompt,
  parseCollabPlan,
  type AgentDef,
  type WebMode,
} from "./lib/agents";
import {
  listKnowledge,
  saveKnowledge,
  deleteKnowledge,
  knowledgeBlockFor,
  type KnowledgeItem,
} from "./lib/knowledge";
import {
  getObsidianStatus,
  listObsidianLearnNotes,
  fetchObsidianNote,
  type ObsidianStatus,
  type ObsidianNoteInfo,
} from "./lib/obsidian";
import {
  listReports,
  fetchReport,
  saveReport,
  deleteReport,
  type ReportInfo,
  type ReportDoc,
} from "./lib/reports";
import {
  getArtStatus,
  listArt,
  generateArtImage,
  deleteArtImage,
  getOfficeBg,
  generateOfficeBgImage,
  type ArtImage,
  type ArtStatus,
  type OfficeBgMeta,
} from "./lib/art";
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
  getBraveKeyStatus,
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
  kind: "request" | "instruction" | "draft" | "review" | "revision" | "summary" | "status" | "error" | "talk";
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
  /** Brave 검색 키 등록 여부 — 없으면 웹 리서치가 web_fetch 전용으로 강등된다 */
  braveOk: boolean;
  /** PM이 지시를 분류해 필요한 에이전트에게만 배정하는 자동 분배 모드 */
  autoRoute: boolean;
  orchRunning: boolean;
  stopRequested: boolean;
  cards: Record<string, OrchCard>;
  feed: FeedMsg[];

  agentHealth: Record<string, AgentHealth>;
  healthRunning: boolean;

  reports: ReportInfo[];
  reportBusy: Record<string, boolean>;
  reportPreview: ReportDoc | null;
  /** 읽은 보고서 ts 목록 (프로젝트별 localStorage 영속) — 사이드바 미확인 배지용 */
  readReports: number[];
  /** 보고서 → GDD 반영 전 PM 가치검증 상태 */
  reportVerify: {
    ts: number;
    agentId: string;
    title: string;
    status: "running" | "ready" | "rejected" | "error";
    verdict?: string;
    finalText?: string;
    error?: string;
  } | null;

  /** 아트 인턴 (로컬 Stable Diffusion) */
  artStatus: ArtStatus | null;
  artImages: ArtImage[];
  artBusy: boolean;
  /** 진행 단계 표시 ("프롬프트 의뢰 중" / "이미지 생성 중") */
  artPhase: string;

  /** 작업 중인 에이전트의 부분 응답 미리보기 (사무실 말풍선 라이브) */
  livePeek: Record<string, string>;

  /** 사무실 배경 테마 ("none"|"auto"|"day"|"night"|"cat"|"custom") — localStorage 영속 */
  officeTheme: string;
  /** 아트 인턴이 그린 커스텀 배경 메타 (없으면 null) */
  officeBg: OfficeBgMeta | null;
  officeBgBusy: boolean;
  officeBgPhase: string;

  /** 프로필 창이 열린 에이전트 (모델/API 개별 설정) */
  profileAgent: string | null;

  /** PM 오늘의 브리핑 진행 중 */
  briefingBusy: boolean;

  /** 지식 라이브러리 (스튜디오 공용) */
  knowledge: KnowledgeItem[];
  /** 제출된 지식의 PM 검증 대기 상태 */
  pendingKnowledge: {
    title: string;
    content: string;
    status: "running" | "ready" | "rejected" | "error";
    reason?: string;
    summary?: string;
    agents?: string[];
    error?: string;
    /** 옵시디안 노트에서 온 경우의 출처·갱신 감지·frontmatter 지정 대상 */
    source?: string;
    srcMtime?: number;
    presetAgents?: string[];
  } | null;

  /** 옵시디안 볼트 연동 상태 + #ve-학습 노트 목록 */
  obsidian: ObsidianStatus | null;
  obsidianNotes: ObsidianNoteInfo[];

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
  setAutoRoute: (b: boolean) => void;
  loadBraveStatus: () => Promise<void>;
  setModelName: (m: string) => void;
  startOrch: () => Promise<void>;
  stopOrch: () => void;
  clearFeed: () => void;
  /** 풀 기획 회의 — 7명 전체 + 교차 검토 + GDD 반영을 구성하고 요청이 있으면 즉시 시작 */
  fullMeeting: () => Promise<void>;

  healthCheck: () => Promise<void>;

  /** 개인 단위 정식 보고서(명세서) 생성 — 현재 GDD 전문을 근거로 작성해 프로젝트에 저장 */
  generateReport: (agentId: string, topic: string) => Promise<void>;
  loadReports: () => Promise<void>;
  openReport: (ts: number) => Promise<void>;
  closeReportPreview: () => void;
  removeReport: (ts: number) => Promise<void>;

  /** 보고서 → PM 가치검증(처음 기획과 정합) → 오너 승인 → GDD 반영 */
  requestReportVerify: (ts: number) => Promise<void>;
  approveReportVerify: () => Promise<void>;
  dismissReportVerify: () => void;

  /** 아트 인턴 — 아트 디렉터가 프롬프트를 쓰고 로컬 SD가 이미지를 뽑는다 */
  checkArtStatus: () => Promise<void>;
  loadArt: () => Promise<void>;
  generateArt: (request: string) => Promise<void>;
  removeArt: (ts: number) => Promise<void>;
  /** 컨셉 아트를 GDD "8. 아트" 섹션에 이미지로 삽입 */
  attachArtToGdd: (ts: number) => Promise<void>;

  /** 사무실 배경 — 테마 선택 + 아트 인턴에게 새 배경 그리게 하기 */
  setOfficeTheme: (t: string) => void;
  loadOfficeBg: () => Promise<void>;
  generateOfficeBg: (request: string) => Promise<void>;

  /** 에이전트 프로필 창 (개별 모델/API 설정·활동 요약) */
  openProfile: (id: string) => void;
  closeProfile: () => void;

  /** PM 오늘의 브리핑 — 현황·오늘 추천 작업·리스크를 PM 대화방으로 받는다 */
  dailyBriefing: () => Promise<void>;

  /** 기존 기획 문서 가져오기 — 원문은 보고서함 보관, 선택 시 PM 분배로 GDD 통합 */
  importDocument: (name: string, text: string, integrate: boolean) => Promise<void>;

  /** 지식 라이브러리 — 제출 → PM 필요성 검증 → 승인 시 학습 */
  loadKnowledge: () => Promise<void>;
  submitKnowledge: (
    title: string,
    content: string,
    opts?: { source?: string; srcMtime?: number; presetAgents?: string[] }
  ) => Promise<void>;
  approveKnowledge: () => Promise<void>;
  dismissKnowledge: () => void;
  removeKnowledge: (ts: number) => Promise<void>;

  /** 옵시디안 — 볼트 상태·학습 후보 갱신 + 노트를 PM 검증 파이프라인으로 */
  loadObsidian: () => Promise<void>;
  learnFromObsidian: (relPath: string) => Promise<void>;

  /** 협업 세션 — 선택된 에이전트 2~4명이 서로 대화하며 결론 도출 */
  collabSession: () => Promise<void>;

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
/** 진행 중 오케스트레이션의 중단 컨트롤러 — ⏹ 클릭 시 실행 중 호출까지 즉시 끊는다 */
let orchAbort: AbortController | null = null;

const readKey = (project: string) => `ve-reports-read:${project}`;
function loadReadSet(project: string): number[] {
  try {
    return JSON.parse(localStorage.getItem(readKey(project)) ?? "[]");
  } catch {
    return [];
  }
}
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
      else if (["done", "completed", "stopped", "finished", "idle"].some((k) => state.includes(k))) {
        setAgentStatus(agentId, "done");
        // 라이브 미리보기 정리
        set((s) => (s.livePeek[agentId] ? { livePeek: { ...s.livePeek, [agentId]: "" } } : s));
      } else if (state) setAgentStatus(agentId, "running");
      return;
    }

    if (frame.event === "chat") {
      const role = String(p.role ?? p.direction ?? "assistant").toLowerCase();
      if (role.includes("user") || role.includes("inbound")) return;
      if (!suffix.startsWith("web-")) {
        // 오케스트레이션/보고서 세션의 부분 텍스트 → 사무실 말풍선 라이브 미리보기
        const delta: string = p.deltaText ?? (typeof p.message === "string" ? p.message : "");
        if (delta) {
          set((s) => ({
            livePeek: { ...s.livePeek, [agentId]: ((s.livePeek[agentId] ?? "") + delta).slice(-120) },
          }));
        }
        return;
      }
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

  /**
   * 협업 라운드 코어 — 멤버들이 2라운드 상호 대화 후 리드가 결론을 내고
   * 보고서함에 저장한다. 오너의 🤝 버튼과 PM 주도 소집이 공용으로 쓴다.
   */
  const runCollabRounds = async (
    members: AgentDef[],
    topic: string,
    project: string,
    runTag: string,
    signal: AbortSignal | undefined,
    overview: string
  ) => {
    let transcript = "";
    const lead = members[0];
    for (let round = 0; round < 2 && !get().stopRequested; round++) {
      for (const agent of members) {
        if (get().stopRequested) break;
        setAgentStatus(agent.id, "running");
        const others = members.filter((m) => m.id !== agent.id);
        const r = await gateway.runAgent(
          agent.id,
          collabPrompt(topic, agent, others, transcript, overview, false),
          runTag,
          signal
        );
        const say = sanitizeAgentOutput(r.text);
        addUsage(r.usage, say);
        transcript += `\n[${agent.name}] ${say}\n`;
        pushFeed({ from: agent.id, kind: "talk", text: say });
        setAgentStatus(agent.id, "done");
      }
    }
    if (get().stopRequested) return;
    setAgentStatus(lead.id, "running");
    const r = await gateway.runAgent(
      lead.id,
      collabPrompt(topic, lead, members.filter((m) => m.id !== lead.id), transcript, overview, true),
      runTag,
      signal
    );
    const conclusion = sanitizeAgentOutput(r.text);
    addUsage(r.usage, conclusion);
    pushFeed({ from: lead.id, kind: "summary", text: conclusion });
    setAgentStatus(lead.id, "done");
    const title = `협업 결론 — ${topic.slice(0, 40)}${topic.length > 40 ? "…" : ""}`;
    await saveReport(project, lead.id, title, `# ${title}\n\n## 결론\n${conclusion}\n\n## 대화 전문\n${transcript}`);
    await get().loadReports();
    pushFeed({
      from: "system",
      kind: "status",
      text: "📋 협업 결론이 보고서함에 저장되었습니다 — PM 가치검증을 거쳐 GDD에 반영할 수 있습니다.",
    });
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
    braveOk: false,
    autoRoute: true,
    orchRunning: false,
    stopRequested: false,
    cards: {},
    feed: [],

    agentHealth: {},
    healthRunning: false,

    reports: [],
    reportBusy: {},
    reportPreview: null,
    readReports: [],
    reportVerify: null,

    artStatus: null,
    artImages: [],
    artBusy: false,
    artPhase: "",
    livePeek: {},
    officeTheme: ((): string => {
      try {
        return localStorage.getItem("ve-office-theme") ?? "auto";
      } catch {
        return "auto";
      }
    })(),
    officeBg: null,
    officeBgBusy: false,
    officeBgPhase: "",
    profileAgent: null,
    briefingBusy: false,
    knowledge: [],
    pendingKnowledge: null,
    obsidian: null,
    obsidianNotes: [],

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
      void get().loadBraveStatus();
      await get().loadProjects();
      void get().loadGdd();
      // 저장된 피드/기본 에이전트 채팅 복원
      const project = get().activeProject;
      if (project) {
        const feed = await loadFeedHistory(project);
        if (feed.length > 0 && get().activeProject === project) set({ feed });
        void ensureChatLoaded(get().activeAgent);
        void get().loadReports();
        void get().loadArt();
      }
      void get().checkArtStatus();
      void get().loadOfficeBg();
      void get().loadKnowledge();
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
        reports: [],
        reportBusy: {},
        reportPreview: null,
        artImages: [],
      });
      await get().loadGdd();
      const feed = await loadFeedHistory(id);
      if (get().activeProject === id && feed.length > 0) set({ feed });
      void ensureChatLoaded(get().activeAgent);
      void get().loadReports();
      void get().loadArt();
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
    setAutoRoute: (b) => set({ autoRoute: b }),
    setModelName: (m) => set({ modelName: m }),
    loadBraveStatus: async () => {
      try {
        set({ braveOk: await getBraveKeyStatus() });
      } catch {
        /* 상태 조회 실패 시 미등록으로 간주 */
      }
    },
    fullMeeting: async () => {
      set({
        selected: Object.fromEntries(SPECIALISTS.map((a) => [a.id, true])),
        crossReview: true,
        autoReflect: true,
        // 풀 기획 회의는 "전원 참여"가 목적 — PM 자동 분배가 인원을 줄이지 않게 해제
        autoRoute: false,
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
      const pool = SPECIALISTS.filter((a) => st.selected[a.id]);
      if (pool.length === 0) return;
      const project = st.activeProject || "np";
      const runTag = `${project}-orch-${Date.now().toString(36)}`;

      orchAbort = new AbortController();
      const signal = orchAbort.signal;
      set({
        orchRunning: true,
        stopRequested: false,
        cards: { pm: { agentId: "pm", state: "pending", output: "" } },
      });
      pushFeed({ from: "user", kind: "request", text: req });

      // 웹 리서치 수준 — 검색 키가 없으면 web_fetch 전용으로 강등 (web_search 오류 방지)
      const web: WebMode = st.webResearch ? (st.braveOk ? "full" : "fetch") : "off";
      if (web === "fetch") {
        pushFeed({
          from: "system",
          kind: "status",
          text: "🔍 웹 검색 키가 등록되지 않아 이번 리서치는 페이지 조회(web_fetch)만 사용합니다. 사이드바 🔑에서 Brave 키를 등록하면 검색도 가능해집니다.",
        });
      }

      // 기획 보존 모드 — 현재 GDD를 읽어 각 에이전트에게 "기존 기획 + 새 지시" 컨텍스트로 전달
      let baseMd = get().gdd;
      try {
        baseMd = (await fetchGdd(project)).markdown;
      } catch {
        /* 저장본을 못 읽으면 화면의 최신 상태 사용 */
      }
      const overview = getSectionBody(baseMd, "## 1.");

      // PM 자동 분배 — 지시를 분류해 관련 담당자에게만 배정한다 (실패 시 선택된 전원 폴백)
      let targets = pool;
      const focusMap: Record<string, string> = {};
      if (st.autoRoute && pool.length > 1 && !get().stopRequested) {
        updateCard("pm", { state: "running", phase: "지시 분류 중", startedAt: Date.now() });
        setAgentStatus("pm", "running");
        pushFeed({ from: "pm", kind: "status", text: "지시를 분석해 담당자를 배정하는 중…" });
        try {
          const r = await gateway.runAgent("pm", pmRoutePrompt(req, pool), `${runTag}-route`, signal);
          const routeText = sanitizeAgentOutput(r.text);
          addUsage(r.usage, r.text);
          // PM이 협업 회의를 소집했으면 개별 배정 대신 협업 세션 실행
          const collab = parseCollabPlan(routeText, pool.map((a) => a.id));
          if (collab) {
            const members = collab.members.map((id) => AGENT_MAP[id]);
            pushFeed({
              from: "pm",
              kind: "instruction",
              text: `이 건은 개별 작업보다 **협업 회의**가 필요합니다. ${members.map((m) => `${m.emoji} ${m.name}`).join(" ↔ ")} 소집 — 주제: ${collab.topic}`,
            });
            setAgentStatus("pm", "done");
            updateCard("pm", { state: "done", phase: undefined });
            try {
              await runCollabRounds(members, collab.topic, project, `${runTag}-collab`, signal, overview);
            } catch (e: any) {
              if (!get().stopRequested) {
                pushFeed({ from: "system", kind: "error", text: `⚠️ 협업 실패: ${String(e?.message ?? e).slice(0, 120)}` });
              }
            }
            set({ orchRunning: false });
            return;
          }
          const routed = parseRoutePlan(routeText, pool.map((a) => a.id));
          if (routed.length > 0) {
            targets = routed.map((p) => AGENT_MAP[p.id]);
            for (const p of routed) focusMap[p.id] = p.directive;
            pushFeed({
              from: "pm",
              kind: "instruction",
              text: routed
                .map((p) => `**${AGENT_MAP[p.id].emoji} ${AGENT_MAP[p.id].name}** — ${p.directive}`)
                .join("\n\n"),
            });
          } else {
            pushFeed({
              from: "system",
              kind: "status",
              text: "PM의 배정 결과를 해석하지 못해 선택된 전원에게 전달합니다.",
            });
          }
        } catch (e: any) {
          pushFeed({
            from: "system",
            kind: "status",
            text: `⚠️ PM 분배 단계 실패 (${String(e?.message ?? e).slice(0, 80)}) — 선택된 전원에게 전달합니다.`,
          });
        }
        setAgentStatus("pm", "done");
        updateCard("pm", { state: "pending", phase: undefined, startedAt: undefined });
      }

      set((s) => ({
        cards: {
          ...s.cards,
          ...Object.fromEntries(targets.map((a) => [a.id, { agentId: a.id, state: "queued" as const, output: "" }])),
        },
      }));

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
          // 마케팅 담당관은 웹 조사가 기본 업무 — 토글과 무관하게 최소 web_fetch는 허용
          const agentWeb: WebMode = agent.id === "marketing" ? (get().braveOk ? "full" : "fetch") : web;
          const instruction = specialistPrompt(
            req,
            agent,
            agentWeb,
            getSectionBody(baseMd, agent.section),
            overview,
            focusMap[agent.id] ?? "",
            knowledgeBlockFor(agent.id, get().knowledge)
          );
          updateCard(agent.id, { state: "running", phase: "초안 작성 중", startedAt: Date.now(), instruction });
          setAgentStatus(agent.id, "running");
          pushFeed({ from: "pm", to: agent.id, kind: "instruction", text: instruction });
          try {
            const r = await gateway.runAgent(agent.id, instruction, runTag, signal);
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
                const rv = await gateway.runAgent(
                  reviewer.id,
                  reviewPrompt(req, agent, reviewer, draft),
                  `${runTag}-rv`,
                  signal
                );
                const review = sanitizeAgentOutput(rv.text);
                addUsage(rv.usage, review);
                pushFeed({ from: reviewer.id, to: agent.id, kind: "review", text: review });
                setAgentStatus(reviewer.id, "done");

                updateCard(agent.id, { phase: "검토 반영 수정 중" });
                setAgentStatus(agent.id, "running");
                const rev = await gateway.runAgent(agent.id, revisePrompt(agent, reviewer, review), runTag, signal);
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
            if (get().stopRequested) {
              // 오너의 ⏹ 중단 — 오류가 아니라 중단으로 표시
              updateCard(agent.id, { state: "pending", phase: undefined, endedAt: Date.now() });
              setAgentStatus(agent.id, "idle");
              return;
            }
            updateCard(agent.id, { state: "error", phase: undefined, error: String(e?.message ?? e), endedAt: Date.now() });
            setAgentStatus(agent.id, "error");
            pushFeed({ from: "system", kind: "error", text: `⚠️ ${agent.name} 작업 실패: ${String(e?.message ?? e).slice(0, 120)}` });
          }
        }
      };

      // 클라우드 모델이면 여러 명이 진짜 동시에 일한다. 로컬(GPU 1개)은 1을 권장.
      const n = Math.max(1, Math.min(7, st.concurrency));
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
          const r = await gateway.runAgent("pm", pmInstruction, runTag, signal);
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
          // 회의록 자동 저장 — 3명 이상 참여한 회의는 기록을 남긴다 (결정론적 취합, 추가 호출 없음)
          if (results.length >= 3) {
            const now = new Date();
            const minutes = [
              `# 회의록 — ${now.toLocaleString("ko-KR", { hour12: false })}`,
              ``,
              `## 오너 지시`,
              req,
              ``,
              `## 참여 (${results.length}명)`,
              results.map(({ agent }) => `- ${agent.emoji} ${agent.name} — "${agent.sectionTitle}" 담당`).join("\n"),
              ``,
              `## PM 통합 결론`,
              get().cards["pm"]?.output ?? clean,
              ``,
              `## 확정 산출물 요약`,
              ...results.map(
                ({ agent, text }) => `### ${agent.emoji} ${agent.sectionTitle} (${agent.name})\n${text.slice(0, 600)}${text.length > 600 ? "\n…(전문은 GDD 참조)" : ""}\n`
              ),
            ].join("\n");
            try {
              await saveReport(project, "pm", `회의록 — ${req.slice(0, 30)}${req.length > 30 ? "…" : ""}`, minutes);
              await get().loadReports();
              pushFeed({ from: "system", kind: "status", text: "📋 회의록이 보고서함에 저장되었습니다." });
            } catch {
              /* 회의록 저장 실패는 치명적이지 않음 */
            }
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
      // 진행 중 호출까지 즉시 끊는다 (서버측 브리지가 CLI 프로세스를 kill)
      orchAbort?.abort();
      pushFeed({ from: "system", kind: "status", text: "⏹ 즉시 중단 — 진행 중이던 호출을 끊었습니다." });
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

    /* ── 보고서 (개인 단위 정식 명세서) ─────────────── */

    generateReport: async (agentId, topic) => {
      const agent = AGENT_MAP[agentId];
      const project = get().activeProject;
      const title = topic.trim();
      if (!agent || !project || !title || get().reportBusy[agentId]) return;
      set((s) => ({ reportBusy: { ...s.reportBusy, [agentId]: true } }));
      setAgentStatus(agentId, "running");
      try {
        let gddFull = get().gdd;
        try {
          gddFull = (await fetchGdd(project)).markdown;
        } catch {
          /* 화면의 최신 상태 사용 */
        }
        const r = await gateway.runAgent(
          agentId,
          reportPrompt(agent, title, gddFull, knowledgeBlockFor(agentId, get().knowledge)),
          `report-${project}-${Date.now().toString(36)}`
        );
        const markdown = sanitizeAgentOutput(r.text);
        addUsage(r.usage, markdown);
        if (!markdown || markdown.length < 50) throw new Error("보고서 내용이 비어 있습니다");
        const ts = await saveReport(project, agentId, title, markdown);
        await get().loadReports();
        setAgentStatus(agentId, "done");
        // 채팅에 완료 안내 남기기 (해당 에이전트 대화방)
        set((s) => ({
          chats: {
            ...s.chats,
            [agentId]: [
              ...(s.chats[agentId] ?? []),
              {
                id: `rp-${ts}`,
                role: "assistant" as const,
                text: `📋 보고서 **"${title}"** 작성 완료 (${markdown.length.toLocaleString()}자) — 오른쪽 GDD 패널의 📋 보고서함에서 열람·다운로드할 수 있습니다.`,
                ts: Date.now(),
              },
            ],
          },
        }));
        persistChat(agentId);
        // 미리보기 바로 열기
        set({ reportPreview: { ts, agent: agentId, title, markdown } });
      } catch (e: any) {
        setAgentStatus(agentId, "error");
        set((s) => ({
          chats: {
            ...s.chats,
            [agentId]: [
              ...(s.chats[agentId] ?? []),
              {
                id: `rpe-${Date.now()}`,
                role: "assistant" as const,
                text: `⚠️ 보고서 생성 실패: ${String(e?.message ?? e).slice(0, 150)}`,
                error: true,
                ts: Date.now(),
              },
            ],
          },
        }));
      } finally {
        set((s) => ({ reportBusy: { ...s.reportBusy, [agentId]: false } }));
      }
    },

    loadReports: async () => {
      const project = get().activeProject;
      if (!project) return;
      const reports = await listReports(project);
      if (get().activeProject === project) set({ reports, readReports: loadReadSet(project) });
    },

    openReport: async (ts) => {
      const project = get().activeProject;
      if (!project) return;
      const doc = await fetchReport(project, ts);
      // 읽음 처리 — 사이드바 미확인 배지 해제
      const read = Array.from(new Set([...get().readReports, ts]));
      try {
        localStorage.setItem(readKey(project), JSON.stringify(read.slice(-200)));
      } catch {
        /* noop */
      }
      set({ reportPreview: doc, gddPreview: null, gddEditing: false, readReports: read });
    },

    closeReportPreview: () => set({ reportPreview: null }),

    removeReport: async (ts) => {
      const project = get().activeProject;
      if (!project) return;
      await deleteReport(project, ts);
      set((s) => ({ reportPreview: s.reportPreview?.ts === ts ? null : s.reportPreview }));
      await get().loadReports();
    },

    /* ── 보고서 → PM 가치검증 → 오너 승인 → GDD 반영 ── */

    requestReportVerify: async (ts) => {
      const project = get().activeProject;
      if (!project || get().reportVerify?.status === "running") return;
      const doc = await fetchReport(project, ts);
      const agent = AGENT_MAP[doc.agent];
      if (!agent) return;
      set({ reportVerify: { ts, agentId: doc.agent, title: doc.title, status: "running" } });
      setAgentStatus("pm", "running");
      try {
        const cur = await fetchGdd(project);
        const r = await gateway.runAgent(
          "pm",
          reportVerifyPrompt(
            agent,
            doc.title,
            doc.markdown,
            getSectionBody(cur.markdown, "## 1."),
            getSectionBody(cur.markdown, agent.section)
          ),
          `rverify-${project}-${Date.now().toString(36)}`
        );
        const full = sanitizeAgentOutput(r.text);
        addUsage(r.usage, full);
        const m = /###\s*반영안\s*\n?/.exec(full);
        const verdict = m ? full.slice(0, m.index).trim() : full;
        const finalText = m ? full.slice(m.index + m[0].length).trim() : "";
        set({
          reportVerify: {
            ts,
            agentId: doc.agent,
            title: doc.title,
            // PM이 반영안을 쓰지 않았다면 "반영 비권고"로 처리
            status: finalText ? "ready" : "rejected",
            verdict,
            finalText,
          },
        });
        setAgentStatus("pm", "done");
      } catch (e: any) {
        set({
          reportVerify: {
            ts,
            agentId: doc.agent,
            title: doc.title,
            status: "error",
            error: String(e?.message ?? e).slice(0, 150),
          },
        });
        setAgentStatus("pm", "error");
      }
    },

    approveReportVerify: async () => {
      const rv = get().reportVerify;
      if (!rv || rv.status !== "ready" || !rv.finalText) return;
      // reflectToGdd → 저장 시 서버가 직전 버전을 자동 백업한다
      await get().reflectToGdd(rv.agentId, rv.finalText);
      set({ reportVerify: null });
    },

    dismissReportVerify: () => set({ reportVerify: null }),

    /* ── 아트 인턴 (로컬 Stable Diffusion) ──────────── */

    checkArtStatus: async () => {
      set({ artStatus: await getArtStatus() });
    },

    loadArt: async () => {
      const project = get().activeProject;
      if (!project) return;
      const artImages = await listArt(project);
      if (get().activeProject === project) set({ artImages });
    },

    generateArt: async (request) => {
      const project = get().activeProject;
      const req = request.trim();
      if (!project || !req || get().artBusy) return;
      set({ artBusy: true, artPhase: "🎨 아트 디렉터가 프롬프트 작성 중…" });
      setAgentStatus("visual", "running");
      try {
        // 1) 아트 디렉터가 확정된 아트 방향에 맞는 SD 프롬프트를 쓴다
        let baseMd = get().gdd;
        try {
          baseMd = (await fetchGdd(project)).markdown;
        } catch {
          /* 화면 상태 사용 */
        }
        const r = await gateway.runAgent(
          "visual",
          sdPromptPrompt(req, getSectionBody(baseMd, "## 8."), getSectionBody(baseMd, "## 1.")),
          `sdprompt-${project}-${Date.now().toString(36)}`
        );
        addUsage(r.usage, r.text);
        const parsed = parseSdPrompt(sanitizeAgentOutput(r.text));
        if (!parsed) throw new Error("아트 디렉터의 프롬프트를 해석하지 못했습니다");
        setAgentStatus("visual", "done");

        // 2) 아트 인턴(로컬 SD)이 이미지를 생성한다
        set({ artPhase: "🖌️ 아트 인턴이 이미지 생성 중… (로컬 GPU, 수십 초)" });
        await generateArtImage(project, parsed.prompt, parsed.negative, req);
        await get().loadArt();
      } catch (e: any) {
        setAgentStatus("visual", "error");
        // 실패 사유는 다음 시도 전까지 스튜디오에 남겨둔다
        set({ artBusy: false, artPhase: `⚠️ ${String(e?.message ?? e).slice(0, 120)}` });
        return;
      }
      set({ artBusy: false, artPhase: "" });
    },

    removeArt: async (ts) => {
      const project = get().activeProject;
      if (!project) return;
      await deleteArtImage(project, ts);
      await get().loadArt();
    },

    attachArtToGdd: async (ts) => {
      const project = get().activeProject;
      const img = get().artImages.find((i) => i.ts === ts);
      if (!project || !img) return;
      const caption = (img.request || "컨셉 아트").replace(/[\[\]]/g, "");
      const imgMd = `![${caption}](/api/art/file?project=${encodeURIComponent(project)}&ts=${ts})`;
      gddQueue = gddQueue.then(async () => {
        try {
          const cur = await fetchGdd(project);
          const body = getSectionBody(cur.markdown, "## 8.");
          // 기존 아트 섹션 내용은 유지하고 이미지를 뒤에 덧붙인다 (저장 시 자동 백업)
          const md = replaceSection(cur.markdown, "## 8.", "아트", body ? `${body}\n\n${imgMd}` : imgMd);
          const mtime = await saveGdd(project, md);
          set({ gdd: md, gddMtime: mtime });
        } catch (e) {
          console.warn("[art] GDD 삽입 실패:", e);
        }
      });
      await gddQueue;
    },

    /* ── 사무실 배경 (아트 인턴이 그리는 스튜디오 인테리어) ── */

    setOfficeTheme: (t) => {
      try {
        localStorage.setItem("ve-office-theme", t);
      } catch {
        /* noop */
      }
      set({ officeTheme: t });
    },

    loadOfficeBg: async () => {
      set({ officeBg: await getOfficeBg() });
    },

    generateOfficeBg: async (request) => {
      if (get().officeBgBusy) return;
      set({ officeBgBusy: true, officeBgPhase: "🎨 아트 디렉터가 배경 컨셉을 잡는 중…" });
      try {
        // 아트 디렉터가 지금 만드는 게임의 분위기를 반영한 프롬프트를 쓴다.
        // 디렉터가 응답하지 못해도 기본 컨셉으로 인턴이 그린다 — 배경 기능은 항상 동작해야 한다.
        let prompt =
          "(pixel art:1.3), 16-bit retro game background art, cozy game development studio interior, wide shot, large windows with warm light, wooden desks with computer monitors, bookshelves, potted plants, highly detailed pixelart scene, empty room, no people";
        let negative = "";
        try {
          const project = get().activeProject;
          let overview = "";
          if (project) {
            try {
              overview = getSectionBody((await fetchGdd(project)).markdown, "## 1.");
            } catch {
              /* 개요 없이 진행 */
            }
          }
          setAgentStatus("visual", "running");
          const r = await gateway.runAgent(
            "visual",
            officeBgSdPrompt(request, overview),
            `officebg-${Date.now().toString(36)}`
          );
          addUsage(r.usage, r.text);
          const parsed = parseSdPrompt(sanitizeAgentOutput(r.text));
          if (parsed?.prompt) {
            prompt = parsed.prompt;
            negative = parsed.negative;
          }
          setAgentStatus("visual", "done");
        } catch {
          setAgentStatus("visual", "idle");
        }
        set({ officeBgPhase: "🖌️ 아트 인턴이 사무실 배경을 그리는 중… (로컬 GPU, 수십 초)" });
        await generateOfficeBgImage(prompt, negative, request);
        await get().loadOfficeBg();
        get().setOfficeTheme("custom");
        set({ officeBgBusy: false, officeBgPhase: "" });
      } catch (e: any) {
        set({ officeBgBusy: false, officeBgPhase: `⚠️ ${String(e?.message ?? e).slice(0, 120)}` });
      }
    },

    /* ── 에이전트 프로필 창 ─────────────────────────── */

    openProfile: (id) => set({ profileAgent: AGENT_MAP[id] ? id : null }),
    closeProfile: () => set({ profileAgent: null }),

    /* ── PM 오늘의 브리핑 (데일리 스탠드업) ─────────── */

    dailyBriefing: async () => {
      const project = get().activeProject;
      if (!project || get().briefingBusy || get().chatBusy.pm) return;
      // 히스토리를 먼저 불러와야 새 메시지가 기존 PM 대화를 덮어쓰지 않는다
      await ensureChatLoaded("pm");
      get().selectAgent("pm");
      set((s) => ({
        briefingBusy: true,
        chatBusy: { ...s.chatBusy, pm: true },
        chats: {
          ...s.chats,
          pm: [
            ...(s.chats.pm ?? []),
            {
              id: `u-${Date.now()}`,
              role: "user" as const,
              text: "☀️ 오늘의 브리핑 — 현황, 오늘 추천 작업, 리스크를 정리해줘",
              ts: Date.now(),
            },
          ],
        },
      }));
      setAgentStatus("pm", "running");
      try {
        let gddFull = get().gdd;
        try {
          gddFull = (await fetchGdd(project)).markdown;
        } catch {
          /* 화면 상태 사용 */
        }
        const projectName = get().projects.find((p) => p.id === project)?.name ?? "";
        const reportLines = get()
          .reports.slice(0, 8)
          .map(
            (r) =>
              `- [${AGENT_MAP[r.agent]?.name ?? r.agent}] ${r.title} (${new Date(r.ts).toLocaleDateString("ko-KR")})`
          )
          .join("\n");
        const r = await gateway.runAgent(
          "pm",
          briefingPrompt(projectName, gddFull, reportLines, knowledgeBlockFor("pm", get().knowledge)),
          `brief-${project}-${Date.now().toString(36)}`
        );
        const text = sanitizeAgentOutput(r.text) || "(빈 브리핑)";
        addUsage(r.usage, text);
        set((s) => ({
          chats: {
            ...s.chats,
            pm: [...(s.chats.pm ?? []), { id: `a-${Date.now()}`, role: "assistant" as const, text, ts: Date.now() }],
          },
        }));
        setAgentStatus("pm", "done");
      } catch (e: any) {
        set((s) => ({
          chats: {
            ...s.chats,
            pm: [
              ...(s.chats.pm ?? []),
              {
                id: `e-${Date.now()}`,
                role: "assistant" as const,
                text: `⚠️ 브리핑 실패: ${String(e?.message ?? e).slice(0, 150)}`,
                error: true,
                ts: Date.now(),
              },
            ],
          },
        }));
        setAgentStatus("pm", "error");
      } finally {
        set((s) => ({ briefingBusy: false, chatBusy: { ...s.chatBusy, pm: false } }));
        persistChat("pm");
      }
    },

    /* ── 기존 기획 문서 가져오기 ─────────────────────── */

    importDocument: async (name, text, integrate) => {
      const project = get().activeProject;
      if (!project || !text.trim()) return;
      // ① 원문은 항상 보고서함에 보관 (유실 방지)
      await saveReport(project, "pm", `가져온 문서 — ${name}`.slice(0, 110), text.slice(0, 100000));
      await get().loadReports();
      if (!integrate) return;
      // ② PM 자동 분배 오케스트레이션으로 기존 기획에 통합 (증분 모드)
      set({
        orchRequest: `[가져온 기획 문서 통합] 오너의 기존 기획 문서다. 이 내용을 현재 기획에 통합해라 — 문서가 기존 기획과 충돌하면 문서 쪽을 우선하되 요약해서 반영해라.\n\n${text.slice(0, 6000)}`,
        autoRoute: true,
      });
      await get().startOrch();
    },

    /* ── 지식 라이브러리 (이론 학습) ─────────────────── */

    loadKnowledge: async () => {
      set({ knowledge: await listKnowledge() });
    },

    submitKnowledge: async (title, content, opts) => {
      if (get().pendingKnowledge?.status === "running") return;
      set({ pendingKnowledge: { title, content, status: "running", ...opts } });
      setAgentStatus("pm", "running");
      try {
        const r = await gateway.runAgent(
          "pm",
          knowledgeVerifyPrompt(title, content, AGENTS),
          `knowledge-${Date.now().toString(36)}`
        );
        const full = sanitizeAgentOutput(r.text);
        addUsage(r.usage, full);
        const v = parseKnowledgeVerdict(full, SPECIALISTS.map((a) => a.id).concat("pm"));
        set({
          pendingKnowledge: {
            title,
            content,
            status: v.approved && v.summary ? "ready" : "rejected",
            reason: v.reason,
            summary: v.summary,
            agents: v.agents,
            ...opts,
          },
        });
        setAgentStatus("pm", "done");
      } catch (e: any) {
        set({
          pendingKnowledge: { title, content, status: "error", error: String(e?.message ?? e).slice(0, 150), ...opts },
        });
        setAgentStatus("pm", "error");
      }
    },

    approveKnowledge: async () => {
      const pk = get().pendingKnowledge;
      if (!pk || pk.status !== "ready" || !pk.summary) return;
      // 노트 frontmatter가 대상을 지정했으면 PM 판정보다 우선한다 (오너의 명시가 우위)
      const agents = pk.presetAgents?.length ? pk.presetAgents : (pk.agents ?? ["all"]);
      await saveKnowledge(pk.title, pk.summary, pk.content, agents, pk.source, pk.srcMtime);
      set({ pendingKnowledge: null });
      await get().loadKnowledge();
      if (pk.source?.startsWith("obsidian:")) void get().loadObsidian();
    },

    dismissKnowledge: () => set({ pendingKnowledge: null }),

    removeKnowledge: async (ts) => {
      await deleteKnowledge(ts);
      await get().loadKnowledge();
      if (get().obsidian?.connected) void get().loadObsidian();
    },

    /* ── 옵시디안 볼트 연동 ─────────────────────────── */

    loadObsidian: async () => {
      const status = await getObsidianStatus();
      set({ obsidian: status });
      if (status.connected) set({ obsidianNotes: await listObsidianLearnNotes() });
    },

    learnFromObsidian: async (relPath) => {
      if (get().pendingKnowledge?.status === "running") return;
      try {
        const note = await fetchObsidianNote(relPath);
        if (!note.content.trim()) throw new Error("노트 내용이 비어 있습니다");
        await get().submitKnowledge(note.title, note.content, {
          source: `obsidian:${relPath}`,
          srcMtime: note.mtime,
          presetAgents: note.agents,
        });
      } catch (e: any) {
        set({
          pendingKnowledge: {
            title: relPath,
            content: "",
            status: "error",
            error: String(e?.message ?? e).slice(0, 150),
          },
        });
      }
    },

    /* ── 협업 세션 (에이전트 간 직접 대화) ──────────── */

    collabSession: async () => {
      const st = get();
      const topic = st.orchRequest.trim();
      if (!topic || st.orchRunning) return;
      const members = SPECIALISTS.filter((a) => st.selected[a.id]);
      if (members.length < 2 || members.length > 4) return;
      const project = st.activeProject || "np";
      const runTag = `collab-${project}-${Date.now().toString(36)}`;
      orchAbort = new AbortController();
      const signal = orchAbort.signal;
      set({ orchRunning: true, stopRequested: false });
      pushFeed({ from: "user", kind: "request", text: `🤝 협업 세션: ${topic}` });
      pushFeed({
        from: "system",
        kind: "status",
        text: `${members.map((a) => `${a.emoji} ${a.name}`).join(" ↔ ")} — PM 없이 서로 대화하며 결론을 만듭니다 (2라운드 + 결론).`,
      });

      let baseMd = get().gdd;
      try {
        baseMd = (await fetchGdd(project)).markdown;
      } catch {
        /* noop */
      }
      try {
        await runCollabRounds(members, topic, project, runTag, signal, getSectionBody(baseMd, "## 1."));
      } catch (e: any) {
        if (!get().stopRequested) {
          pushFeed({ from: "system", kind: "error", text: `⚠️ 협업 세션 실패: ${String(e?.message ?? e).slice(0, 120)}` });
        }
      }
      set({ orchRunning: false });
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
