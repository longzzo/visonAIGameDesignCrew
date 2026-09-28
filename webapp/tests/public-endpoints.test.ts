import { describe, expect, it } from "vitest";
import { parseLatestManifest, verifyPublicEndpoints } from "../../scripts/verify-public-endpoints.mjs";

const product = {
  websiteUrl: "https://example.test/",
  privacyUrl: "https://example.test/privacy",
  termsUrl: "https://example.test/terms",
  refundPolicyUrl: "https://example.test/refund",
  supportPolicyUrl: "https://example.test/support",
  updateUrl: "https://example.test/releases/latest/download/",
  updatesEnabled: true,
};

function response(url: string, body = "", init: ResponseInit = {}) {
  const value = new Response(body, init);
  Object.defineProperty(value, "url", { value: url });
  return value;
}

describe("공개 판매·업데이트 엔드포인트 검증", () => {
  it("latest.yml의 상용 업데이트 필드를 읽는다", () => {
    expect(parseLatestManifest("version: 4.2.7\npath: VisionEngine-Setup-4.2.7.exe\nsha512: abc=\nsize: 123\n"))
      .toEqual({ version: "4.2.7", path: "VisionEngine-Setup-4.2.7.exe", sha512: "abc=", size: 123 });
  });

  it("법적 페이지와 설치 EXE·blockmap이 모두 공개된 릴리스를 통과시킨다", async () => {
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("latest.yml")) {
        return response(url, "version: 4.2.7\npath: VisionEngine-Setup-4.2.7.exe\nsha512: abc=\nsize: 123\n", { status: 200 });
      }
      if (init?.method === "HEAD") {
        return response(url, "", { status: 200, headers: { "content-length": url.endsWith(".blockmap") ? "45" : "123" } });
      }
      return response(url, "공개 문서", { status: 200 });
    };
    const report = await verifyPublicEndpoints({ product, expectedVersion: "4.2.7", fetchImpl: fetchImpl as typeof fetch });
    expect(report.ok).toBe(true);
    expect(report.update.manifest.version).toBe("4.2.7");
    expect(Object.values(report.legal).every((item) => item.ok)).toBe(true);
  });

  it("비공개 법적 페이지와 오래된 업데이트 피드를 출시 실패로 처리한다", async () => {
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/refund")) return response(url, "없음", { status: 404 });
      if (url.endsWith("latest.yml")) {
        return response(url, "version: 4.2.6\npath: VisionEngine-Setup-4.2.6.exe\nsha512: old=\nsize: 100\n", { status: 200 });
      }
      return response(url, "공개 문서", { status: 200 });
    };
    const report = await verifyPublicEndpoints({ product, expectedVersion: "4.2.7", fetchImpl: fetchImpl as typeof fetch });
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/refundPolicyUrl.*HTTP 404/);
    expect(report.errors.join("\n")).toContain("latest.yml 버전 불일치");
  });

  it("HTTPS가 아닌 법적 주소를 네트워크 호출 전에 거부한다", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: URL | RequestInfo) => {
      calls.push(String(input));
      return response(String(input), "공개 문서", { status: 200 });
    };
    const report = await verifyPublicEndpoints({
      product: { ...product, termsUrl: "http://example.test/terms" }, legalOnly: true, fetchImpl: fetchImpl as typeof fetch,
    });
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("HTTPS 주소가 아닙니다");
    expect(calls).not.toContain("http://example.test/terms");
  });
});
