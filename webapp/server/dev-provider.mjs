// 개발 실행 어댑터 — Codex SDK 또는 OpenAI 호환 제공자 + MCP 도구 루프로 실제 코드에 관여.
// 제공자 전용 하드코딩 없이 모델 접두사로 OpenClaw 설정의 provider를 찾아 호출하고,
// 모델이 tool_calls를 내면 MCP 허브로 실행해 결과를 되먹인다 (에이전틱 루프).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as hub from "./mcp-hub.mjs";
import { resolveCodexWorkdir } from "./readiness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VE_REPO_ROOT ? path.resolve(process.env.VE_REPO_ROOT) : path.resolve(__dirname, "..", "..");
const OPENCLAW_CFG = path.join(os.homedir(), ".openclaw", "openclaw.json");

function readCfg() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CFG, "utf-8"));
  } catch {
    return {};
  }
}

/** 개발 에이전트의 페르소나(AGENTS.md) — 시스템 프롬프트로 사용 */
function personaOf(agentId) {
  const p = path.join(REPO, "agents", agentId, "AGENTS.md");
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return `너는 ${agentId} 개발 에이전트다.`;
  }
}

/** MCP 도구 → OpenAI function 포맷. 이름은 server__tool 로 네임스페이스.
 *  agentId가 있으면 그 에이전트에 배정된 서버의 도구만 (팀별 유니티 MCP 분리). */
function toolsForOpenAI(agentId) {
  const tools = agentId ? hub.toolsForAgent(agentId) : hub.allTools();
  return tools.map((t) => ({
    type: "function",
    function: {
      name: `${t.server}__${t.name}`,
      description: (t.description ?? "").slice(0, 900),
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

// 추론형 모델(gpt-oss 등)은 reasoning_content에 토큰을 먼저 쓴다.
// 2048이면 긴 과제에서 추론만 하다 예산이 끝나 content가 빈 채 finish_reason=length로 돌아온다
// (실측 2026-08-11: reasoning_content 2,425자를 먼저 쓰고 finish_reason=length로 본문 잘림). 상향하고 env로 뺐다.
const MAX_TOKENS = Number(process.env.VE_DEV_MAX_TOKENS ?? 8192);

function resolveApiKey(providerId, provider) {
  const envName = `${providerId.replace(/\W/g, "_").toUpperCase()}_API_KEY`;
  const ref = String(provider?.secretRef || "");
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] || "";
  if (process.env[envName]) return process.env[envName];
  const raw = typeof provider?.apiKey === "string" ? provider.apiKey : "";
  return raw.includes("{{") ? "" : raw;
}

export function resolveProvider(model, cfg) {
  const fullModel = String(model || "");
  const providerId = fullModel.split("/")[0];
  const provider = cfg?.models?.providers?.[providerId];
  if (!provider) throw new Error(`모델 제공자를 찾지 못했습니다: ${providerId || "(없음)"}`);
  let baseUrl = String(provider.baseUrl || "").replace(/\/+$/, "");
  if (provider.api === "ollama" && !baseUrl.endsWith("/v1")) baseUrl += "/v1";
  const modelId = fullModel.slice(providerId.length + 1);
  const catalog = (provider.models || []).find((item) => item.id === modelId);
  const key = resolveApiKey(providerId, provider) || (provider.api === "ollama" ? "ollama-local" : "");
  return { id: providerId, label: providerId, baseUrl, key, modelId, maxTokensField: catalog?.compat?.maxTokensField || "max_tokens" };
}

async function openAICompatibleChat(provider, messages, tools) {
  const body = {
    model: provider.modelId,
    messages,
    temperature: 0.3,
  };
  body[provider.maxTokensField] = MAX_TOKENS;
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const r = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${provider.label} ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * 개발 작업 실행 — dev 에이전트에게 태스크를 주고, MCP 도구를 쓰며 최대 maxSteps회 반복.
 * onStep(step) 콜백으로 진행 상황(생각/도구호출/결과)을 스트리밍.
 * @returns { ok, transcript[], final }
 */
export async function runDevTask({ agentId, task, model, maxSteps = 8, onStep }) {
  const cfg = readCfg();
  const useModel = model || cfg?.models?.agents?.[agentId] || cfg?.agents?.defaults?.model?.primary || "openai/gpt-oss-120b";
  const provider = resolveProvider(useModel, cfg);
  if (!provider.key) throw new Error(`${provider.label} API 키가 없습니다 — 환경 변수 또는 사이드바 🔑로 등록하세요.`);

  // 프로젝트가 바뀌었으면 MCP를 그 프로젝트로 다시 물린다(안 하면 옛 정본을 읽는다)
  await hub.ensureCurrentProject();
  const tools = toolsForOpenAI(agentId);

  const transcript = [];
  const push = (step) => {
    transcript.push(step);
    try {
      onStep?.(step);
    } catch {
      /* noop */
    }
  };

  // 배정된 도구에 맞춰 지시를 바꾼다. 읽기 전용 에이전트에게 "코드를 수정해라"라고 시키면
  // 없는 도구를 호출하려다 실패하거나, 안 한 일을 했다고 보고한다.
  const canWrite = tools.some((t) => /^\w+__(write_file|edit_file|move_file|create_directory)$/.test(t.function.name));
  const hasCanon = tools.some((t) => t.function.name.startsWith("canon__"));
  const system = [
    personaOf(agentId),
    "",
    tools.length === 0
      ? "⚠️ 지금 너에게는 파일 접근 도구가 없다. 파일 내용을 추측하거나 파일명을 지어내지 말고, '도구가 없어 확인할 수 없다'고 명시해라."
      : "너는 지금 실제 프로젝트 파일에 접근할 수 있는 도구를 가지고 있다. 추측하지 말고 반드시 도구로 읽어 확인한 뒤 답해라.",
    hasCanon
      ? "정본(GDD·decisions·kit/data CSV)은 canon__list / canon__read / canon__grep 으로 읽는다. 수치·id·규칙을 말하기 전에 canon__grep으로 실재를 확인해라. 0건이면 정본에 없는 것이니, 새로 제안하는 것이라면 '신규'라고 명시해라."
      : "",
    canWrite
      ? "파일을 작성·수정할 때는 기존 파일을 먼저 읽어 맥락을 파악하고, 최소한의 변경으로 정확히 반영해라."
      : "너에게는 쓰기 도구가 없다. 파일을 고치지 말고 무엇을 어떻게 바꿔야 하는지 위치와 함께 제안만 해라.",
    "작업을 마치면 무엇을 왜 했는지 한국어로 요약해라.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: task },
  ];

  push({ kind: "task", text: task });

  for (let step = 0; step < maxSteps; step++) {
    const res = await openAICompatibleChat(provider, messages, tools);
    const msg = res?.choices?.[0]?.message;
    if (!msg) throw new Error("빈 응답");
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (msg.content && msg.content.trim()) push({ kind: "say", text: msg.content.trim() });

    if (calls.length === 0) {
      const body = (msg.content ?? "").trim();
      // 추론형 모델이 예산을 다 쓰면 content가 빈 채로 돌아온다(finish_reason=length).
      // 그걸 "(작업 완료)"로 덮으면 다음 단계가 빈 입력을 받고도 정상처럼 흘러간다 → 플래그로 남긴다.
      return {
        ok: true,
        transcript,
        final: body || "(응답 없음 — 모델이 본문을 반환하지 않았습니다)",
        empty: !body,
        finishReason: res?.choices?.[0]?.finish_reason ?? null,
      };
    }

    for (const call of calls) {
      const fname = call.function?.name ?? "";
      const [server, ...rest] = fname.split("__");
      const toolName = rest.join("__");
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        /* 인자 파싱 실패는 빈 객체로 */
      }
      push({ kind: "tool", server, name: toolName, args });
      let resultText = "";
      let isError = false;
      try {
        const out = await hub.callTool(server, toolName, args);
        resultText = out.text;
        isError = out.isError;
      } catch (e) {
        resultText = String(e?.message ?? e);
        isError = true;
      }
      push({ kind: "toolResult", server, name: toolName, isError, text: resultText.slice(0, 1500) });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultText.slice(0, 8000),
      });
    }
  }
  return { ok: true, transcript, final: "(최대 단계 도달 — 작업이 길어 중단됨)" };
}

/** 공식 Codex SDK 기반 코딩 실행 — 작업 폴더 쓰기만 허용하고 권한 확대·네트워크는 막는다. */
export async function runCodexTask({ agentId, task, onStep }) {
  const { Codex } = await import("@openai/codex-sdk");
  const selected = resolveCodexWorkdir();
  if (!selected.exists || !selected.writable) {
    throw new Error(`Codex 작업 폴더를 사용할 수 없습니다: ${selected.dir}. 첫 실행 준비에서 쓰기 가능한 프로젝트 폴더를 선택하세요.`);
  }
  const workingDirectory = selected.dir;
  const push = (step) => {
    try { onStep?.(step); } catch { /* noop */ }
  };
  push({ kind: "task", text: task });
  push({ kind: "phase", text: `🤖 Codex 구현 — ${workingDirectory}` });
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });
  const { events } = await thread.runStreamed(`${personaOf(agentId)}\n\n작업 지시:\n${task}`);
  let final = "";
  for await (const event of events) {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex 실행 실패");
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (item.type === "agent_message") {
      final = item.text || final;
      push({ kind: "say", text: item.text, agent: agentId });
    } else if (item.type === "command_execution") {
      push({
        kind: "toolResult",
        server: "codex",
        name: "shell",
        isError: item.status === "failed",
        text: `${item.command}\n${item.aggregated_output || ""}`.slice(0, 2000),
      });
    } else if (item.type === "file_change") {
      push({ kind: "tool", server: "codex", name: "apply_patch", args: item.changes });
    }
  }
  return { ok: true, transcript: [], final: final || "Codex 작업이 끝났지만 최종 설명이 없습니다.", empty: !final };
}

/**
 * 개발 회의 — 구현(리드) → 코드 리뷰어 검토 → 테스트 엔지니어 검증을 순차로.
 * 각 단계가 MCP 도구로 실제 kit 파일을 읽고(리뷰·테스트)/쓰며(구현) 교차 검증한다.
 * onStep에 { agent } 태그를 붙여 누가 말하는지 구분한다.
 */
export async function runDevMeeting({ leadId, task, engine = "provider", onStep }) {
  const emit = (agent) => (s) => onStep?.({ ...s, agent });
  const say = (kind, text, agent) => onStep?.({ kind, text, agent });

  // 1) 구현
  say("phase", `🔨 구현 — ${leadId}`, leadId);
  const impl = engine === "codex"
    ? await runCodexTask({ agentId: leadId, task, onStep: emit(leadId) })
    : await runDevTask({ agentId: leadId, task, maxSteps: 10, onStep: emit(leadId) });

  // 2) 코드 리뷰
  say("phase", "👁️ 코드 리뷰 — review", "review");
  const rev = await runDevTask({
    agentId: "review",
    task:
      `방금 팀원이 아래 작업을 수행했다:\n${impl.final}\n\n` +
      `도구로 관련 파일을 직접 읽어 코드 리뷰를 해라. 심각도(🔴 반드시수정 / 🟡 개선 / 🟢 좋음)로 분류하고, 구체적 위치와 수정 방향을 제시해라.`,
    maxSteps: 8,
    onStep: emit("review"),
  });

  // 3) 테스트·검증
  say("phase", "🧪 검증 — testeng", "testeng");
  const test = await runDevTask({
    agentId: "testeng",
    task:
      `구현 요약:\n${impl.final}\n\n리뷰 요약:\n${rev.final}\n\n` +
      `도구로 결과 파일을 직접 읽어 검증하고, 엣지 케이스를 점검해라. 판정을 ✅ 통과 / ⚠️ 조건부 / ❌ 미흡 중 하나로 명시하고 근거를 대라.`,
    maxSteps: 8,
    onStep: emit("testeng"),
  });

  // 빈 응답을 통과로 읽지 않는다. 판정 정규식은 "❌도 ⚠️도 없으면 통과"라서
  // 본문이 비어 있어도 ✅가 나왔다(실측 2026-08-11: 3단계 전부 빈 채로 ✅ 통과).
  const isEmpty = (r) => !!r?.empty || !r?.final || r.final.trim().length < 40 || /^\(응답 없음|^\(작업 완료\)$/.test(r.final.trim());
  const blanks = [
    ["구현", impl],
    ["리뷰", rev],
    ["검증", test],
  ].filter(([, r]) => isEmpty(r));

  /**
   * 본문 전체를 훑으면 오판한다 — testeng가 `**판정**: ⚠️ 조건부 (기본 미흡)`이라고 쓰자
   * 뒤쪽 "미흡"이 먼저 걸려 **❌ 미흡**으로 뒤집혔다(실측 2026-08-12).
   * 그래서 "판정"이라고 적힌 줄을 먼저 찾고, 그 줄에서 **가장 앞에 나온** 표식을 쓴다.
   */
  const readVerdict = (text) => {
    const src = String(text ?? "");
    const line = src.split(/\r?\n/).find((l) => /판정/.test(l) && /(✅|⚠️|❌|통과|조건부|미흡)/.test(l)) ?? src;
    const hits = [
      ["❌ 미흡", line.search(/❌|미흡/)],
      ["⚠️ 조건부", line.search(/⚠️|조건부/)],
      ["✅ 통과", line.search(/✅|통과/)],
    ].filter(([, i]) => i >= 0);
    if (!hits.length) return "✅ 통과";
    return hits.sort((a, b) => a[1] - b[1])[0][0];
  };

  const verdict = blanks.length ? `⚠️ 판정 불가 — ${blanks.map(([n]) => n).join("·")} 단계가 빈 응답` : readVerdict(test.final);
  if (blanks.length) {
    const why = blanks.map(([n, r]) => `${n}(finish_reason=${r?.finishReason ?? "?"})`).join(", ");
    say("phase", `⚠️ 빈 응답 감지 — ${why}. VE_DEV_MAX_TOKENS를 올리거나 과제를 쪼개세요.`, "testeng");
  }
  onStep?.({ kind: "done", final: `개발 회의 완료 — 최종 판정 ${verdict}` });
  return { ok: true, impl, rev, test, verdict, blanks: blanks.map(([n]) => n) };
}
