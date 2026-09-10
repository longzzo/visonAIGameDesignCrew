import { describe, expect, it } from "vitest";
import { mergeAgentRoster, preserveUnknownConfig, readAgentRoster, writeAgentRoster } from "../../scripts/openclaw-merge.mjs";

const policy = {
  retiredModelPatterns: ["retired-model"],
  roles: { planner: "ollama/qwen3.5:4b" },
  localFallback: "ollama/qwen3.5:4b",
};

describe("OpenClaw 로스터 병합", () => {
  it("최신 agents.entries 형식을 읽고 id 손실 없이 다시 기록한다", () => {
    const modern: any = { agents: { entries: { pm: { name: "PM", model: "ollama/qwen3.5:4b" } } } };
    expect(readAgentRoster(modern)).toEqual([{ id: "pm", name: "PM", model: "ollama/qwen3.5:4b" }]);

    const legacy: any = { agents: { list: [{ id: "pm", name: "PM" }] } };
    writeAgentRoster(legacy, readAgentRoster(legacy));
    expect(legacy.agents).toEqual({ entries: { pm: { name: "PM" } } });
  });

  it("explicit ownership에서는 충돌하는 레거시 default 표식을 제거한다", () => {
    const config: any = { agents: { ownership: "explicit" } };
    writeAgentRoster(config, [{ id: "pm", name: "PM", default: true }]);
    expect(config.agents).toEqual({ ownership: "explicit", entries: { pm: { name: "PM" } } });
  });

  it("관리 에이전트는 갱신하고 사용자 에이전트는 원본 그대로 보존한다", () => {
    const custom = { id: "my-specialist", name: "내 전문가", model: "custom/model", workspace: "D:/agents/mine" };
    const result = mergeAgentRoster({
      templateAgents: [{ id: "pm", name: "새 PM", model: "ollama/default" }],
      previousAgents: [{ id: "pm", name: "옛 PM", model: "ollama/my-choice" }, custom],
      roles: new Map([["pm", "planner"]]),
      modelPolicy: policy,
      providerReady: () => true,
    });

    expect(result.agents).toEqual([
      { id: "pm", name: "새 PM", model: "ollama/my-choice" },
      custom,
    ]);
    expect(result.customIds).toEqual(["my-specialist"]);
  });

  it("종료 모델과 준비되지 않은 제공자는 로컬 안전 모델로 바꾼다", () => {
    const result = mergeAgentRoster({
      templateAgents: [{ id: "pm", model: "cloud/default" }],
      previousAgents: [{ id: "pm", model: "cloud/retired-model" }],
      roles: new Map([["pm", "planner"]]),
      modelPolicy: policy,
      providerReady: (model: string) => model.startsWith("ollama/"),
    });
    expect(result.agents[0].model).toBe("ollama/qwen3.5:4b");
  });

  it("사용자 에이전트의 설정은 보존하고 종료 모델만 로컬 모델로 이전한다", () => {
    const result = mergeAgentRoster({
      templateAgents: [{ id: "pm", model: "ollama/default" }],
      previousAgents: [
        { id: "pm", model: "ollama/default" },
        { id: "archivist", name: "기록관", model: "cloud/retired-model", workspace: "D:/agents/archive", customFlag: true },
      ],
      roles: new Map([["pm", "planner"]]),
      modelPolicy: policy,
      providerReady: () => true,
    });

    expect(result.agents[1]).toEqual({
      id: "archivist",
      name: "기록관",
      model: "ollama/qwen3.5:4b",
      workspace: "D:/agents/archive",
      customFlag: true,
    });
    expect(result.customIds).toEqual(["archivist"]);
  });
});

describe("OpenClaw 사용자 확장 설정 보존", () => {
  it("템플릿 값은 유지하면서 템플릿에 없는 채널·플러그인·제공자를 보존한다", () => {
    const template: any = { gateway: { port: 18789 }, plugins: { entries: { duckduckgo: { enabled: true } } }, models: { providers: {} } };
    const previous = {
      gateway: { port: 19999, customFlag: true },
      channels: { discord: { enabled: true } },
      plugins: { entries: { myPlugin: { enabled: true } } },
      models: { providers: { private: { baseUrl: "http://private" } } },
    };
    expect(preserveUnknownConfig(template, previous)).toEqual({
      gateway: { port: 18789, customFlag: true },
      channels: previous.channels,
      plugins: { entries: { duckduckgo: { enabled: true }, myPlugin: { enabled: true } } },
      models: previous.models,
    });
  });
});
