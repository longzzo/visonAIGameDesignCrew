import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webapp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(webapp, ".desktop-runtime");
const source = JSON.parse(fs.readFileSync(path.join(webapp, "package.json"), "utf-8"));
if (path.dirname(target) !== webapp || path.basename(target) !== ".desktop-runtime") {
  throw new Error(`안전하지 않은 런타임 준비 경로: ${target}`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({
  name: "vision-engine-desktop-runtime",
  private: true,
  version: source.version,
  dependencies: source.dependencies,
  overrides: source.overrides,
}, null, 2));

const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const command = fs.existsSync(npmCli) ? process.execPath : "npm";
const args = [...(fs.existsSync(npmCli) ? [npmCli] : []), "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];
const result = spawnSync(command, args, {
  cwd: target,
  stdio: "inherit",
  windowsHide: true,
});
if (result.status !== 0) throw new Error(`데스크톱 런타임 의존성 설치 실패 (${result.status}): ${result.error?.message || "npm 오류"}`);
console.log("✅ 데스크톱용 프로덕션 의존성 준비 완료 (개발·Marp CLI 제외)");
