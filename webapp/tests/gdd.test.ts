import { describe, expect, it } from "vitest";
import {
  getSectionBody,
  isDeadModelError,
  isGatewayErrorText,
  replaceSection,
  sanitizeAgentOutput,
} from "../src/lib/gdd";

describe("GDD 정본 편집", () => {
  const gdd = "# GDD\n\n## 1. 개요\n기존 개요\n\n## 2. 세계관\n기존 세계관\n";

  it("지정한 절만 교체하고 다른 절은 보존한다", () => {
    const next = replaceSection(gdd, "## 1.", "개요", "새 개요");
    expect(getSectionBody(next, "## 1.")).toContain("새 개요");
    expect(getSectionBody(next, "## 2.")).toContain("기존 세계관");
  });

  it("없는 절은 문서 끝에 안전하게 추가한다", () => {
    const next = replaceSection(gdd, "## 3.", "게임플레이", "코어 루프");
    expect(next).toContain("## 3. 게임플레이");
    expect(next).toContain("코어 루프");
  });
});

describe("에이전트 출력 방어", () => {
  it("종료 모델과 게이트웨이 오류를 정상 산출물로 보지 않는다", () => {
    expect(isDeadModelError("HTTP 410 model not found")).toBe(true);
    expect(isGatewayErrorText("openclaw gateway 실행 실패: timeout")).toBe(true);
  });

  it("도구 호출 JSON 누수를 경고와 격리된 코드블록으로 표시한다", () => {
    const clean = sanitizeAgentOutput('{"name":"write_file","arguments":{"path":"x"}}');
    expect(clean).toContain("⚠️ 모델이 도구 호출 형식으로 응답");
    expect(clean).toContain("```");
  });
});
