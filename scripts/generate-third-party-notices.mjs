import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = [path.join(root, "webapp"), path.join(root, "desktop")];
const packages = new Map();

function inferLicense(packageDir) {
  try {
    const licenseFile = fs.readdirSync(packageDir).find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
    if (!licenseFile) return "UNKNOWN";
    const head = fs.readFileSync(path.join(packageDir, licenseFile), "utf-8").slice(0, 500);
    if (/MIT License/i.test(head)) return "MIT";
    if (/Apache License[\s\S]{0,80}Version 2/i.test(head)) return "Apache-2.0";
    if (/BSD 3-Clause/i.test(head)) return "BSD-3-Clause";
    if (/BSD 2-Clause/i.test(head)) return "BSD-2-Clause";
    return "SEE LICENSE FILE";
  } catch { return "UNKNOWN"; }
}

for (const project of projects) {
  const lockFile = path.join(project, "package-lock.json");
  if (!fs.existsSync(lockFile)) continue;
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
  for (const relative of Object.keys(lock.packages || {})) {
    if (!relative.includes("node_modules/")) continue;
    const packageFile = path.join(project, relative, "package.json");
    if (!fs.existsSync(packageFile)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf-8"));
      if (!pkg.name || !pkg.version) continue;
      const license = typeof pkg.license === "string" ? pkg.license : Array.isArray(pkg.licenses) ? pkg.licenses.map((item) => item?.type).filter(Boolean).join(" OR ") : inferLicense(path.dirname(packageFile));
      const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || pkg.homepage || "";
      packages.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, license, repository });
    } catch { /* 손상된 패키지 메타데이터는 출시 검사에서 UNKNOWN으로 다룬다 */ }
  }
}

const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const unknown = rows.filter((pkg) => !pkg.license || pkg.license === "UNKNOWN");
const lines = [
  "# Third-Party Notices",
  "",
  "Vision Engine includes the following third-party software. Each component remains subject to its own license.",
  "",
  "| Package | Version | License | Source |",
  "| --- | --- | --- | --- |",
  ...rows.map((pkg) => `| ${pkg.name.replaceAll("|", "\\|")} | ${pkg.version} | ${pkg.license.replaceAll("|", "\\|")} | ${pkg.repository ? `[link](${String(pkg.repository).replace(/^git\+/, "").replace(/\.git$/, "")})` : ""} |`),
  "",
  "Additional bundled reference assets retain the license files stored beside those assets in `docs/reference` and `webapp/assets`.",
  "",
];
fs.writeFileSync(path.join(root, "THIRD-PARTY-NOTICES.md"), `${lines.join("\n")}\n`, "utf-8");
console.log(`✅ 제3자 패키지 ${rows.length}개 고지 생성${unknown.length ? ` · 라이선스 미확인 ${unknown.length}개` : ""}`);
if (unknown.length) process.exitCode = 2;
