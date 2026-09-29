import { describe, expect, it } from "vitest";
import { buildBudgetedContext, estimateContextTokens } from "../src/lib/context";

describe("context budget", () => {
  it("keeps high priority blocks and stays under budget", () => {
    const result = buildBudgetedContext(
      [
        { id: "style", label: "스타일", text: "스타일 ".repeat(900), priority: 10, maxTokens: 500 },
        { id: "decisions", label: "확정 결정", text: "결정 ".repeat(900), priority: 100, maxTokens: 500 },
        { id: "vault", label: "옵시디안", text: "기억 ".repeat(900), priority: 80, maxTokens: 500 },
      ],
      900
    );
    expect(result.usedTokens).toBeLessThanOrEqual(900);
    expect(result.text).toContain("[확정 결정]");
    expect(result.text.indexOf("[확정 결정]")).toBeLessThan(result.text.indexOf("[옵시디안]"));
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.compressed).toContain("확정 결정");
  });

  it("marks blocks that do not fit instead of silently losing them", () => {
    const result = buildBudgetedContext(
      [
        { id: "a", label: "필수", text: "A".repeat(1500), priority: 100, maxTokens: 380 },
        { id: "b", label: "낮은 우선순위", text: "B".repeat(1500), priority: 1, maxTokens: 380 },
      ],
      400
    );
    expect(result.text).toContain("예산에 맞춰 압축");
    expect(result.omitted).toContain("낮은 우선순위");
    expect(estimateContextTokens(result.text)).toBeLessThanOrEqual(400);
  });
});
