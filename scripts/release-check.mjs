import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const product = JSON.parse(fs.readFileSync(path.join(root, "config", "product.json"), "utf-8"));
const desktop = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package.json"), "utf-8"));
const blockers = [];
const warnings = [];

const requiredFiles = ["desktop/EULA.txt", "PRIVACY.md", "SECURITY.md", "THIRD-PARTY-NOTICES.md"];
for (const relative of requiredFiles) if (!fs.existsSync(path.join(root, relative))) blockers.push(`필수 배포 문서 없음: ${relative}`);

for (const field of ["vendor", "legalName", "sellerCountry", "supportEmail", "websiteUrl", "privacyUrl", "termsUrl", "refundPolicyUrl", "supportPolicyUrl", "updateUrl"]) {
  if (!String(product[field] || "").trim()) blockers.push(`제품 메타데이터 미입력: ${field}`);
}
if (product.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(product.supportEmail)) blockers.push("supportEmail 형식 오류");
if (!Number.isInteger(product.supportResponseHours) || product.supportResponseHours <= 0) blockers.push("supportResponseHours는 1 이상의 정수여야 함");
if (product.sellerCountry && !/^[A-Z]{2}$/.test(product.sellerCountry)) blockers.push("sellerCountry는 ISO 3166-1 alpha-2 국가 코드여야 함");
for (const field of ["websiteUrl", "privacyUrl", "termsUrl", "refundPolicyUrl", "supportPolicyUrl", "updateUrl"]) {
  if (product[field] && !String(product[field]).startsWith("https://")) blockers.push(`${field}는 HTTPS URL이어야 함`);
}
const publishUrl = desktop.build?.publish?.find?.((entry) => entry?.provider === "generic")?.url;
if (product.updateUrl && publishUrl !== product.updateUrl) blockers.push("앱 updateUrl과 electron-builder generic publish URL이 일치하지 않음");
if (product.updatesEnabled !== true) blockers.push("업데이트 채널이 아직 활성화되지 않음: updatesEnabled=true 필요");

const electronVersion = String(desktop.devDependencies?.electron || "");
const electronMajor = Number(electronVersion.match(/\d+/)?.[0] || 0);
if (electronMajor < 44) blockers.push(`Electron 보안 기준 미달: ${electronVersion}`);
if (desktop.build?.win?.signExecutable === false) blockers.push("electron-builder 실행 파일 서명이 명시적으로 꺼져 있음");
if (!desktop.build?.electronFuses?.enableEmbeddedAsarIntegrityValidation || !desktop.build?.electronFuses?.onlyLoadAppFromAsar) {
  blockers.push("ASAR 무결성 Fuse가 완전히 활성화되지 않음");
}
if (desktop.build?.electronFuses?.grantFileProtocolExtraPrivileges !== false) {
  blockers.push("file:// 프로토콜 추가 권한 Fuse가 비활성화되지 않음");
}
if (desktop.build?.afterPack !== "scripts/harden-electron-fuses.mjs") {
  blockers.push("최신 Electron Fuse 전체를 강제하는 afterPack 검사가 설정되지 않음");
}

const signingReady = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK || desktop.build?.win?.certificateSubjectName);
if (!signingReady) blockers.push("Windows 코드 서명 자격증명 없음");
if (desktop.build?.electronFuses?.runAsNode !== false) blockers.push("RunAsNode Fuse가 비활성화되지 않음");

function audit(project, { omitDev, label }) {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const command = fs.existsSync(npmCli) ? process.execPath : "npm";
  const args = [...(fs.existsSync(npmCli) ? [npmCli] : []), "audit", ...(omitDev ? ["--omit=dev"] : []), "--json"];
  const result = spawnSync(command, args, { cwd: path.join(root, project), encoding: "utf-8", windowsHide: true });
  try {
    const report = JSON.parse(result.stdout || "{}");
    if (!report?.metadata?.vulnerabilities) {
      blockers.push(`${project} ${label} npm audit를 완료하지 못함${report?.message ? `: ${String(report.message).slice(0, 120)}` : ""}`);
      return null;
    }
    const raw = report.metadata.vulnerabilities;
    const counts = Object.fromEntries(["info", "low", "moderate", "high", "critical", "total"].map((key) => [key, Number(raw[key] || 0)]));
    if (counts.moderate > 0 || counts.high > 0 || counts.critical > 0) {
      blockers.push(`${project} ${label} 취약점: moderate ${counts.moderate}, high ${counts.high}, critical ${counts.critical}`);
    }
    return counts;
  } catch {
    blockers.push(`${project} ${label} npm audit 결과를 확인하지 못함`);
    return null;
  }
}

const audits = {
  webapp: audit("webapp", { omitDev: true, label: "프로덕션" }),
  desktop: audit("desktop", { omitDev: true, label: "프로덕션" }),
};
const buildAudits = {
  webapp: audit("webapp", { omitDev: false, label: "전체 빌드" }),
  desktop: audit("desktop", { omitDev: false, label: "전체 빌드" }),
};
const report = { ok: blockers.length === 0, version: desktop.version, product, signingReady, audits, buildAudits, blockers, warnings };
console.log(JSON.stringify(report, null, 2));
if (strict && blockers.length) process.exitCode = 1;
