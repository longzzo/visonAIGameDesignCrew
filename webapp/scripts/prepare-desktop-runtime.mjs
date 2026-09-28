import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webapp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(webapp, ".desktop-runtime");
const source = JSON.parse(fs.readFileSync(path.join(webapp, "package.json"), "utf-8"));
const runtimeFile = path.join(webapp, "dist-server", "runtime.mjs");
if (path.dirname(target) !== webapp || path.basename(target) !== ".desktop-runtime") {
  throw new Error(`안전하지 않은 런타임 준비 경로: ${target}`);
}
if (!fs.existsSync(runtimeFile)) {
  throw new Error("독립 실행 서버를 먼저 빌드해야 합니다: npm run build:runtime");
}

// esbuild의 packages:external 결과에서 실제 런타임 import만 추출한다.
// React/Three.js처럼 브라우저 dist에 이미 번들된 패키지를 서버 node_modules에 다시 넣지 않는다.
const runtimeSource = fs.readFileSync(runtimeFile, "utf-8");
const runtimePackages = new Set();
const importPattern = /(?:\bfrom\s+|\bimport\()(["'])([^"']+)\1/g;
for (const match of runtimeSource.matchAll(importPattern)) {
  const specifier = match[2];
  if (specifier.startsWith("node:") || specifier.startsWith(".") || path.isAbsolute(specifier)) continue;
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  if (name) runtimePackages.add(name);
}
const dependencies = {};
for (const name of [...runtimePackages].sort()) {
  const version = source.dependencies?.[name];
  if (!version) throw new Error(`런타임 외부 패키지가 dependencies에 없습니다: ${name}`);
  dependencies[name] = version;
}
if (!Object.keys(dependencies).length) throw new Error("독립 실행 서버의 외부 패키지를 찾지 못했습니다.");

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({
  name: "vision-engine-desktop-runtime",
  private: true,
  version: source.version,
  dependencies,
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
console.log(`✅ 데스크톱 런타임 의존성 ${Object.keys(dependencies).length}개 준비 완료: ${Object.keys(dependencies).join(", ")}`);
