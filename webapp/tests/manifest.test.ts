import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "config", "agents.manifest.json"), "utf-8"));
const openclaw = JSON.parse(fs.readFileSync(path.join(root, "config", "openclaw.json"), "utf-8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "model-policy.json"), "utf-8"));
const mcp = JSON.parse(fs.readFileSync(path.join(root, "config", "mcp.json"), "utf-8"));

describe("에이전트 manifest", () => {
  it("id가 유일하고 OpenClaw 템플릿과 정확히 일치한다", () => {
    const ids = manifest.agents.map((agent: any) => agent.id);
    const configured = openclaw.agents.list.map((agent: any) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(configured).toEqual(ids);
  });

  it("종료된 모델을 기본 배정이나 모델 카탈로그에 포함하지 않는다", () => {
    const serialized = JSON.stringify(openclaw);
    for (const retired of policy.retiredModelPatterns) expect(serialized).not.toContain(retired);
  });

  it("MCP 미등록 에이전트도 읽기 전용 정본만 받는다", () => {
    expect(mcp.assignments._default).toEqual(["canon"]);
    const readOnlyIds = manifest.agents
      .filter((item: any) => item.modelRole === "head" || item.modelRole === "planner" || ["qa", "fund"].includes(item.id))
      .map((item: any) => item.id);
    for (const id of readOnlyIds) {
      expect(mcp.assignments[id] ?? mcp.assignments._default).toEqual(["canon"]);
    }
  });
});
