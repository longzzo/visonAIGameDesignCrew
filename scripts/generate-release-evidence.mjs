// 설치 자산·SBOM·E2E·서명·제품 메타데이터를 하나의 재현 가능한 릴리스 증거 묶음으로 만든다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(moduleFile), "..");

const hashFile = (algorithm, file, encoding = "hex") =>
  crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

const writeAtomic = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf-8");
  fs.renameSync(temporary, file);
};

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};

export function commercialGateSummary({ product, verification, e2e, publishUrl = product?.updateUrl }) {
  const requiredMetadata = [
    "vendor", "legalName", "sellerCountry", "supportEmail", "websiteUrl", "privacyUrl",
    "termsUrl", "refundPolicyUrl", "supportPolicyUrl", "updateUrl",
  ];
  const missingMetadata = requiredMetadata.filter((field) => !String(product?.[field] || "").trim());
  if (!Number.isInteger(product?.supportResponseHours) || product.supportResponseHours <= 0) {
    missingMetadata.push("supportResponseHours");
  }
  const invalidMetadata = [];
  if (product?.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(product.supportEmail))) invalidMetadata.push("supportEmail");
  if (product?.sellerCountry && !/^[A-Z]{2}$/.test(String(product.sellerCountry))) invalidMetadata.push("sellerCountry");
  for (const field of ["websiteUrl", "privacyUrl", "termsUrl", "refundPolicyUrl", "supportPolicyUrl", "updateUrl"]) {
    if (product?.[field] && !/^https:\/\//i.test(String(product[field]))) invalidMetadata.push(field);
  }
  const signaturesValid = verification?.signature === "Valid" && verification?.appSignature === "Valid";
  const packageVerified = verification?.ok === true;
  const windowsE2E = e2e?.ok === true
    && e2e?.securityHeaders === true
    && e2e?.hostileHostBlocked === true
    && e2e?.hostileOriginBlocked === true
    && e2e?.singleInstance === true
    && e2e?.backupRoundTrip === true
    && e2e?.runtimeAutoRecovery === true
    && e2e?.uninstallVerified === true
    && ["html", "pdf", "pptx"].every((format) => e2e?.deckFormats?.includes(format));
  const updateChannelEnabled = product?.updatesEnabled === true
    && /^https:\/\//i.test(String(product?.updateUrl || ""))
    && String(publishUrl || "") === String(product?.updateUrl || "");
  const metadataComplete = missingMetadata.length === 0 && invalidMetadata.length === 0;
  const blockers = [];
  if (!packageVerified) blockers.push("패키지 구조 검증 실패");
  if (!windowsE2E) blockers.push("Windows 전체 E2E 미통과");
  if (!signaturesValid) blockers.push("Windows Authenticode 서명 미완료");
  if (!updateChannelEnabled) blockers.push("공개 자동 업데이트 채널 미활성");
  if (!metadataComplete) blockers.push(`제품 메타데이터 미완료: ${[...missingMetadata, ...invalidMetadata.map((field) => `${field}(형식)`)].join(", ")}`);
  return {
    packageVerified,
    windowsE2E,
    signaturesValid,
    updateChannelEnabled,
    metadataComplete,
    missingMetadata,
    invalidMetadata,
    customerDistributionReady: blockers.length === 0,
    blockers,
  };
}

function runJson(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${label} 실패: ${String(result.stderr || result.stdout || result.error?.message || "알 수 없는 오류").slice(0, 1_000)}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${label} 결과가 JSON이 아닙니다.`); }
}

function createSbom(projectDir) {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const hasBundledNpm = fs.existsSync(npmCli);
  const command = hasBundledNpm ? process.execPath : "npm";
  const args = [...(hasBundledNpm ? [npmCli] : []), "sbom", "--omit=dev", "--sbom-format", "cyclonedx"];
  const sbom = runJson(command, args, projectDir, `${path.basename(projectDir)} SBOM 생성`);
  if (sbom?.bomFormat !== "CycloneDX" || !Array.isArray(sbom?.components)) throw new Error(`${path.basename(projectDir)} SBOM 형식이 올바르지 않습니다.`);
  return sbom;
}

export function validateUpdateManifest(text, { version, installerName, installerFile }) {
  const declaredVersion = text.match(/^version:\s*(\S+)\s*$/m)?.[1] || "";
  const declaredPath = text.match(/^path:\s*(\S+)\s*$/m)?.[1] || "";
  const declaredSha512 = text.match(/^sha512:\s*(\S+)\s*$/m)?.[1] || "";
  const declaredSize = Number(text.match(/^\s*size:\s*(\d+)\s*$/m)?.[1] || 0);
  if (declaredVersion !== version) throw new Error(`latest.yml 버전 불일치: ${declaredVersion} != ${version}`);
  if (declaredPath !== installerName || !text.includes(`url: ${installerName}`)) throw new Error("latest.yml 설치 파일명 불일치");
  if (declaredSha512 !== hashFile("sha512", installerFile, "base64")) throw new Error("latest.yml SHA-512 불일치");
  if (declaredSize !== fs.statSync(installerFile).size) throw new Error("latest.yml 설치 파일 크기 불일치");
}

export function generateReleaseEvidence({ e2eReport = "", strict = false } = {}) {
  const desktopDir = path.join(root, "desktop");
  const outputDir = path.join(desktopDir, "dist-installer");
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf-8"));
  const product = JSON.parse(fs.readFileSync(path.join(root, "config", "product.json"), "utf-8"));
  const version = String(desktopPackage.version);
  const installerName = `VisionEngine-Setup-${version}.exe`;
  const installer = path.join(outputDir, installerName);
  const blockmap = `${installer}.blockmap`;
  const latest = path.join(outputDir, "latest.yml");
  const versionedE2e = path.join(outputDir, `windows-e2e-report-${version}.json`);
  const genericE2e = path.join(outputDir, "windows-e2e-report.json");
  const e2eFile = path.resolve(root, e2eReport || (fs.existsSync(versionedE2e) ? versionedE2e : genericE2e));
  for (const file of [installer, blockmap, latest, e2eFile]) {
    if (!fs.existsSync(file)) throw new Error(`릴리스 증거 입력 파일 없음: ${path.relative(root, file)}`);
  }

  validateUpdateManifest(fs.readFileSync(latest, "utf-8"), { version, installerName, installerFile: installer });
  const e2e = JSON.parse(fs.readFileSync(e2eFile, "utf-8"));
  if (path.basename(String(e2e.installer || "")) !== installerName) throw new Error("E2E 보고서 설치 파일명이 현재 버전과 다릅니다.");

  const verification = runJson(process.execPath, [path.join(desktopDir, "scripts", "verify-package.mjs")], root, "패키지 검증");
  const webappSbom = createSbom(path.join(root, "webapp"));
  const desktopSbom = createSbom(desktopDir);
  const webappSbomFile = path.join(outputDir, "webapp-sbom.cdx.json");
  const desktopSbomFile = path.join(outputDir, "desktop-sbom.cdx.json");
  writeAtomic(webappSbomFile, `${JSON.stringify(webappSbom, null, 2)}\n`);
  writeAtomic(desktopSbomFile, `${JSON.stringify(desktopSbom, null, 2)}\n`);

  const thirdPartySource = path.join(root, "THIRD-PARTY-NOTICES.md");
  const thirdParty = path.join(outputDir, "THIRD-PARTY-NOTICES.md");
  fs.copyFileSync(thirdPartySource, thirdParty);
  const inputs = [installer, blockmap, latest, webappSbomFile, desktopSbomFile, e2eFile, thirdParty];
  const artifacts = inputs.map((file) => ({
    name: path.basename(file),
    bytes: fs.statSync(file).size,
    sha256: hashFile("sha256", file),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const publishUrl = desktopPackage.build?.publish?.find?.((entry) => entry?.provider === "generic")?.url || "";
  const gates = commercialGateSummary({ product, verification, e2e, publishUrl });
  const evidence = {
    schemaVersion: 1,
    product: product.productName,
    edition: product.edition,
    version,
    generatedAt: new Date().toISOString(),
    artifacts,
    supplyChain: {
      format: "CycloneDX",
      webappComponents: webappSbom.components.length,
      desktopComponents: desktopSbom.components.length,
    },
    packageVerification: {
      ok: verification.ok,
      secretFindings: verification.secretScan?.findings ?? null,
      installerSignature: verification.signature,
      appSignature: verification.appSignature,
      runtimeDependencies: verification.runtimeDependencies,
    },
    windowsE2E: {
      ok: e2e.ok,
      securityHeaders: e2e.securityHeaders,
      hostileHostBlocked: e2e.hostileHostBlocked,
      hostileOriginBlocked: e2e.hostileOriginBlocked,
      singleInstance: e2e.singleInstance,
      deckFormats: e2e.deckFormats,
      backupRoundTrip: e2e.backupRoundTrip,
      runtimeAutoRecovery: e2e.runtimeAutoRecovery,
      uninstallVerified: e2e.uninstallVerified,
      timings: e2e.timings,
      elapsedSeconds: e2e.elapsedSeconds,
    },
    commercialGates: gates,
  };
  const evidenceFile = path.join(outputDir, `release-evidence-${version}.json`);
  writeAtomic(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);

  const checksumFiles = [...inputs, evidenceFile].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const checksumText = `${checksumFiles.map((file) => `${hashFile("sha256", file)}  ${path.basename(file)}`).join("\n")}\n`;
  const checksumsFile = path.join(outputDir, "SHA256SUMS.txt");
  writeAtomic(checksumsFile, checksumText);

  const result = { ok: true, version, evidenceFile, checksumsFile, gates, artifacts: checksumFiles.length };
  console.log(JSON.stringify(result, null, 2));
  if (strict && !gates.customerDistributionReady) process.exitCode = 2;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(moduleFile)) {
  try {
    generateReleaseEvidence({ e2eReport: argumentValue("--e2e-report"), strict: process.argv.includes("--strict") });
  } catch (error) {
    console.error(`릴리스 증거 생성 실패: ${String(error?.message || error).slice(0, 2_000)}`);
    process.exitCode = 1;
  }
}
