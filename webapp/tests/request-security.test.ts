import { describe, expect, it } from "vitest";
import { hostnameAllowed, originMatchesRequest } from "../server/request-security.mjs";

describe("로컬 API 요청 보안", () => {
  it("로컬·Tailscale 호스트만 허용한다", () => {
    expect(hostnameAllowed("127.0.0.1")).toBe(true);
    expect(hostnameAllowed("studio.tailnet.ts.net")).toBe(true);
    expect(hostnameAllowed("attacker.example")).toBe(false);
  });

  it("쓰기 Origin은 포트까지 Host와 정확히 일치해야 한다", () => {
    expect(originMatchesRequest("http://127.0.0.1:5199", "127.0.0.1:5199")).toBe(true);
    expect(originMatchesRequest("http://127.0.0.1:7777", "127.0.0.1:5199")).toBe(false);
    expect(originMatchesRequest("https://attacker.example", "127.0.0.1:5199")).toBe(false);
    expect(originMatchesRequest("", "127.0.0.1:5199")).toBe(true);
  });
});
