import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf-8"));
const output = path.join(desktop, "dist-installer");
const unpacked = path.join(output, "win-unpacked");
const appExe = path.join(unpacked, "Vision Engine.exe");
const installer = path.join(output, `VisionEngine-Setup-${pkg.version}.exe`);
const blockmap = `${installer}.blockmap`;
const latest = path.join(output, "latest.yml");
const errors = [];
const warnings = [];
const require = createRequire(import.meta.url);
const { listPackage } = require("@electron/asar");
const hash = (algorithm, file, encoding = "hex") => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

for (const file of [
  appExe,
  installer,
  blockmap,
  latest,
  path.join(unpacked, "resources", "app.asar"),
  path.join(unpacked, "LICENSE.electron.txt"),
  path.join(unpacked, "LICENSES.chromium.html"),
]) {
  if (!fs.existsSync(file)) errors.push(`패키지 파일 없음: ${path.relative(root, file)}`);
}
const legalSources = new Map([
  ["EULA.txt", path.join(desktop, "EULA.txt")],
  ["PRIVACY.md", path.join(root, "PRIVACY.md")],
  ["SECURITY.md", path.join(root, "SECURITY.md")],
  ["THIRD-PARTY-NOTICES.md", path.join(root, "THIRD-PARTY-NOTICES.md")],
]);
for (const [relative, source] of legalSources) {
  const packaged = path.join(unpacked, "resources", "legal", relative);
  if (!fs.existsSync(packaged)) errors.push(`설치 리소스 법적 문서 없음: ${relative}`);
  else if (!fs.existsSync(source) || hash("sha256", source) !== hash("sha256", packaged)) errors.push(`설치 리소스 법적 문서 불일치: ${relative}`);
}

const sourceProduct = path.join(root, "config", "product.json");
const packagedProduct = path.join(unpacked, "resources", "vision-engine", "config", "product.json");
if (!fs.existsSync(packagedProduct)) errors.push("설치 리소스 제품 메타데이터 없음: config/product.json");
else if (hash("sha256", sourceProduct) !== hash("sha256", packagedProduct)) errors.push("설치 리소스 제품 메타데이터가 소스와 다름");

if (fs.existsSync(latest)) {
  const manifest = fs.readFileSync(latest, "utf-8");
  if (!manifest.includes(`version: ${pkg.version}`)) errors.push("latest.yml 버전이 패키지 버전과 다름");
  if (!manifest.includes(path.basename(installer))) errors.push("latest.yml에 설치 파일이 없음");
  if (fs.existsSync(installer)) {
    const expectedSha512 = hash("sha512", installer, "base64");
    const declaredSha512 = manifest.match(/^sha512:\s*(\S+)\s*$/m)?.[1] || "";
    const declaredSize = Number(manifest.match(/^\s*size:\s*(\d+)\s*$/m)?.[1] || 0);
    if (declaredSha512 !== expectedSha512) errors.push("latest.yml SHA-512가 설치 파일과 다름");
    if (declaredSize !== fs.statSync(installer).size) errors.push("latest.yml 파일 크기가 설치 파일과 다름");
  }
}

const appAsar = path.join(unpacked, "resources", "app.asar");
if (fs.existsSync(appAsar)) {
  const contents = listPackage(appAsar);
  if (!contents.some((entry) => entry.replaceAll("\\", "/").includes("node_modules/electron-updater"))) errors.push("app.asar에 electron-updater가 포함되지 않음");
}

let fuseOutput = "";
if (fs.existsSync(appExe)) {
  const fuseCli = path.join(desktop, "node_modules", "@electron", "fuses", "dist", "bin.js");
  const result = spawnSync(process.execPath, [fuseCli, "read", "--app", appExe], { encoding: "utf-8", windowsHide: true });
  fuseOutput = String(result.stdout || result.stderr || "");
  for (const line of [
    "RunAsNode is Disabled",
    "EnableCookieEncryption is Enabled",
    "EnableNodeOptionsEnvironmentVariable is Disabled",
    "EnableNodeCliInspectArguments is Disabled",
    "EnableEmbeddedAsarIntegrityValidation is Enabled",
    "OnlyLoadAppFromAsar is Enabled",
    "GrantFileProtocolExtraPrivileges is Disabled",
    "WasmTrapHandlers is Enabled",
  ]) if (!fuseOutput.includes(line)) errors.push(`Fuse 검증 실패: ${line}`);
}

function authenticodeStatus(file) {
  const pwshLookup = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf-8", windowsHide: true });
  const powershell = pwshLookup.status === 0 ? String(pwshLookup.stdout).split(/\r?\n/).find(Boolean) : "powershell.exe";
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:VE_VERIFY_EXE).Status.ToString()"], {
    encoding: "utf-8", windowsHide: true, env: { ...process.env, VE_VERIFY_EXE: file },
  });
  return String(result.stdout || "Unknown").trim();
}

let signature = "Unknown";
let appSignature = "Unknown";
if (process.platform === "win32") {
  if (fs.existsSync(installer)) signature = authenticodeStatus(installer);
  if (fs.existsSync(appExe)) appSignature = authenticodeStatus(appExe);
  if (signature !== "Valid") warnings.push(`설치 파일 코드서명 상태: ${signature}`);
  if (appSignature !== "Valid") warnings.push(`앱 실행 파일 코드서명 상태: ${appSignature}`);
  if (process.argv.includes("--strict-signing") && (signature !== "Valid" || appSignature !== "Valid")) {
    errors.push("정식 배포에는 설치 파일과 앱 실행 파일의 유효한 Authenticode 서명이 필요함");
  }
}

let sha256 = "";
if (fs.existsSync(installer)) sha256 = hash("sha256", installer);
const report = { ok: errors.length === 0, version: pkg.version, installer, bytes: fs.existsSync(installer) ? fs.statSync(installer).size : 0, sha256, signature, appSignature, errors, warnings };
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
