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

for (const file of [appExe, installer, blockmap, latest, path.join(unpacked, "resources", "app.asar")]) {
  if (!fs.existsSync(file)) errors.push(`패키지 파일 없음: ${path.relative(root, file)}`);
}
for (const relative of ["EULA.txt", "PRIVACY.md", "SECURITY.md", "THIRD-PARTY-NOTICES.md"]) {
  if (!fs.existsSync(path.join(unpacked, "resources", "legal", relative))) errors.push(`설치 리소스 법적 문서 없음: ${relative}`);
}

if (fs.existsSync(latest)) {
  const manifest = fs.readFileSync(latest, "utf-8");
  if (!manifest.includes(`version: ${pkg.version}`)) errors.push("latest.yml 버전이 패키지 버전과 다름");
  if (!manifest.includes(path.basename(installer))) errors.push("latest.yml에 설치 파일이 없음");
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

let signature = "Unknown";
if (process.platform === "win32" && fs.existsSync(installer)) {
  const pwshLookup = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf-8", windowsHide: true });
  const powershell = pwshLookup.status === 0 ? String(pwshLookup.stdout).split(/\r?\n/).find(Boolean) : "powershell.exe";
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:VE_VERIFY_EXE).Status.ToString()"], {
    encoding: "utf-8", windowsHide: true, env: { ...process.env, VE_VERIFY_EXE: installer },
  });
  signature = String(result.stdout || "Unknown").trim();
  if (signature !== "Valid") warnings.push(`설치 파일 코드서명 상태: ${signature}`);
  if (process.argv.includes("--strict-signing") && signature !== "Valid") errors.push("정식 배포에는 유효한 Authenticode 서명이 필요함");
}

let sha256 = "";
if (fs.existsSync(installer)) sha256 = crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");
const report = { ok: errors.length === 0, version: pkg.version, installer, bytes: fs.existsSync(installer) ? fs.statSync(installer).size : 0, sha256, signature, errors, warnings };
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
