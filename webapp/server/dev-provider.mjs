// 다이렉트 프로바이더 (v2.1b) — 개발팀 에이전트가 MCP 도구를 함수호출로 쓰며 실제 코드에 관여.
// OpenClaw CLI 브리지를 우회해 NVIDIA NIM(OpenAI 호환) API를 직접 호출하고,
// 모델이 tool_calls를 내면 MCP 허브로 실행해 결과를 되먹인다 (에이전틱 루프).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as hub from "./mcp-hub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
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

async function nvidiaChat(model, messages, tools, key, baseUrl) {
  const body = {
    model,
    messages,
    max_tokens: 2048,
    temperature: 0.3,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`NVIDIA ${r.status}: ${txt.slice(0, 200)}`);
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
  const provider = cfg?.models?.providers?.nvidia;
  const key = provider?.apiKey;
  const baseUrl = provider?.baseUrl ?? "https://integrate.api.nvidia.com/v1";
  if (!key || String(key).includes("{{")) {
    throw new Error("NVIDIA API 키가 없습니다 — 사이드바 🔑로 등록하세요 (개발 작업은 함수호출 지원 클라우드 모델 필요).");
  }
  const useModel = model || cfg?.models?.agents?.[agentId] || cfg?.agents?.defaults?.model?.primary || "qwen/qwen3-next-80b-a3b-instruct";
  // provider 접두사(nvidia/) 제거 — NIM API는 순수 모델 id를 받는다
  const modelId = String(useModel).replace(/^nvidia\//, "");

  if (!hub.isStarted()) await hub.startHub();
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

  const system = [
    personaOf(agentId),
    "",
    "너는 지금 실제 프로젝트 파일에 접근할 수 있는 도구를 가지고 있다. 필요하면 도구로 파일을 읽고 확인한 뒤 작업해라.",
    "도구로 코드를 작성·수정할 때는 기존 파일을 먼저 읽어 맥락을 파악하고, 최소한의 변경으로 정확히 반영해라.",
    "작업을 마치면 무엇을 왜 했는지 한국어로 요약해라.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: task },
  ];

  push({ kind: "task", text: task });

  for (let step = 0; step < maxSteps; step++) {
    const res = await nvidiaChat(modelId, messages, tools, key, baseUrl);
    const msg = res?.choices?.[0]?.message;
    if (!msg) throw new Error("빈 응답");
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (msg.content && msg.content.trim()) push({ kind: "say", text: msg.content.trim() });

    if (calls.length === 0) {
      return { ok: true, transcript, final: (msg.content ?? "").trim() || "(작업 완료)" };
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

/**
 * 개발 회의 — 구현(리드) → 코드 리뷰어 검토 → 테스트 엔지니어 검증을 순차로.
 * 각 단계가 MCP 도구로 실제 kit 파일을 읽고(리뷰·테스트)/쓰며(구현) 교차 검증한다.
 * onStep에 { agent } 태그를 붙여 누가 말하는지 구분한다.
 */
export async function runDevMeeting({ leadId, task, onStep }) {
  const emit = (agent) => (s) => onStep?.({ ...s, agent });
  const say = (kind, text, agent) => onStep?.({ kind, text, agent });

  // 1) 구현
  say("phase", `🔨 구현 — ${leadId}`, leadId);
  const impl = await runDevTask({ agentId: leadId, task, maxSteps: 10, onStep: emit(leadId) });

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

  const verdict = /❌|미흡/.test(test.final) ? "❌ 미흡" : /⚠️|조건부/.test(test.final) ? "⚠️ 조건부" : "✅ 통과";
  onStep?.({ kind: "done", final: `개발 회의 완료 — 최종 판정 ${verdict}` });
  return { ok: true, impl, rev, test, verdict };
}
