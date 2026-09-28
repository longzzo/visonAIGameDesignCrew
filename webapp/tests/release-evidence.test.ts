import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commercialGateSummary, validateUpdateManifest } from "../../scripts/generate-release-evidence.mjs";

const completeProduct = {
  vendor: "Vision Engine Test",
  legalName: "Vision Engine Test LLC",
  sellerCountry: "KR",
  supportEmail: "support@example.test",
  websiteUrl: "https://example.test",
  privacyUrl: "https://example.test/privacy",
  termsUrl: "https://example.test/terms",
  refundPolicyUrl: "https://example.test/refund",
  supportPolicyUrl: "https://example.test/support",
  updateUrl: "https://example.test/releases/",
  supportResponseHours: 48,
  updatesEnabled: true,
};

const passingE2e = {
  ok: true,
  securityHeaders: true,
  hostileHostBlocked: true,
  hostileOriginBlocked: true,
  singleInstance: true,
  backupRoundTrip: true,
  runtimeAutoRecovery: true,
  uninstallVerified: true,
  deckFormats: ["html", "pdf", "pptx"],
};

describe("상용 릴리스 증거", () => {
  it("서명·업데이트·메타데이터가 모두 증명돼야 고객 배포 가능으로 판정한다", () => {
    const ready = commercialGateSummary({
      product: completeProduct,
      verification: { ok: true, signature: "Valid", appSignature: "Valid" },
      e2e: passingE2e,
    });
    expect(ready.customerDistributionReady).toBe(true);
    expect(ready.blockers).toEqual([]);

    const blocked = commercialGateSummary({
      product: { ...completeProduct, legalName: "", updatesEnabled: false },
      verification: { ok: true, signature: "NotSigned", appSignature: "NotSigned" },
      e2e: passingE2e,
    });
    expect(blocked.customerDistributionReady).toBe(false);
    expect(blocked.missingMetadata).toContain("legalName");
    expect(blocked.blockers).toEqual(expect.arrayContaining([
      "Windows Authenticode 서명 미완료",
      "공개 자동 업데이트 채널 미활성",
    ]));

    const malformed = commercialGateSummary({
      product: { ...completeProduct, supportEmail: "invalid", sellerCountry: "KOR" },
      verification: { ok: true, signature: "Valid", appSignature: "Valid" },
      e2e: passingE2e,
      publishUrl: completeProduct.updateUrl,
    });
    expect(malformed.invalidMetadata).toEqual(expect.arrayContaining(["supportEmail", "sellerCountry"]));
    expect(malformed.customerDistributionReady).toBe(false);

    const missingE2e = commercialGateSummary({
      product: completeProduct,
      verification: { ok: true, signature: "Valid", appSignature: "Valid" },
      e2e: { ok: false, missing: true },
    });
    expect(missingE2e.windowsE2E).toBe(false);
    expect(missingE2e.blockers).toContain("Windows 전체 E2E 미통과");
  });

  it("latest.yml의 버전·파일명·크기·SHA-512를 실제 설치 파일과 대조한다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-release-evidence-test-"));
    const installerName = "VisionEngine-Setup-9.9.9.exe";
    const installer = path.join(dir, installerName);
    try {
      fs.writeFileSync(installer, "test-installer-content", "utf-8");
      const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest("base64");
      const manifest = `version: 9.9.9\nfiles:\n  - url: ${installerName}\n    sha512: ${sha512}\n    size: ${fs.statSync(installer).size}\npath: ${installerName}\nsha512: ${sha512}\n`;
      expect(() => validateUpdateManifest(manifest, { version: "9.9.9", installerName, installerFile: installer })).not.toThrow();
      expect(() => validateUpdateManifest(manifest.replace("version: 9.9.9", "version: 9.9.8"), {
        version: "9.9.9", installerName, installerFile: installer,
      })).toThrow(/버전 불일치/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
