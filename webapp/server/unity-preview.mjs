// Unity WebGL 빌드를 Vision Engine 안에서 안전하게 미리보기 위한 경로 탐색·검증.
// 빌드 실행 자체는 Unity가 담당하고, 이 모듈은 사용자가 만든 결과물만 읽기 전용으로 제공한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = () => path.resolve(process.env.VE_REPO_ROOT || path.resolve(moduleDir, "..", ".."));
const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || repoRoot());
const configFile = () => path.join(dataRoot(), "config", "unity.local.json");
const SKIP_DIRS = new Set([".git", "Library", "Logs", "obj", "Packages", "ProjectSettings", "Temp", "UserSettings"]);

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), "utf-8")); } catch { return {}; }
}

function writeConfig(value) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

function hasIndex(dir) {
  return !!dir && fs.existsSync(path.join(dir, "index.html"));
}

function findWebglBuild(root) {
  if (!root || !fs.existsSync(root)) return null;
  const common = [
    "Builds/WebGL",
    "Build/WebGL",
    "WebGL",
    "WebGLBuild",
    "Builds/WebGLBuild",
  ].map((rel) => path.join(root, rel));
  for (const candidate of common) if (hasIndex(candidate)) return path.resolve(candidate);

  const queue = [{ dir: path.resolve(root), depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= 4) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const dir = path.join(current.dir, entry.name);
      if (hasIndex(dir) && /(?:webgl|build)/i.test(dir)) return path.resolve(dir);
      queue.push({ dir, depth: current.depth + 1 });
    }
  }
  return null;
}

function newestMtime(root) {
  let latest = 0;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth > 3) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      try {
        const stat = fs.statSync(full);
        latest = Math.max(latest, stat.mtimeMs);
        if (entry.isDirectory()) queue.push({ dir: full, depth: current.depth + 1 });
      } catch { /* 빌드 중 잠깐 사라진 파일은 다음 폴링에서 다시 본다. */ }
    }
  }
  return Math.round(latest);
}

export function getUnityPreviewStatus() {
  const cfg = readConfig();
  const projectDir = String(cfg.dir || process.env.VE_UNITY_DIR || "").trim();
  const configuredBuild = String(cfg.webglDir || "").trim();
  const buildDir = hasIndex(configuredBuild) ? path.resolve(configuredBuild) : findWebglBuild(projectDir);
  const projectExists = !!projectDir && fs.existsSync(projectDir);
  const ready = !!buildDir;
  const updatedAt = ready ? newestMtime(buildDir) : 0;
  const reason = !projectDir
    ? "Unity 프로젝트 경로를 먼저 연결하세요."
    : !projectExists
      ? "등록된 Unity 프로젝트 경로를 찾을 수 없습니다."
      : !ready
        ? "WebGL 빌드를 찾지 못했습니다. Unity에서 Builds/WebGL 폴더로 빌드하세요."
        : "Unity WebGL 빌드가 준비됐습니다.";
  return {
    ready,
    projectDir: projectDir || null,
    projectExists,
    buildDir: buildDir || null,
    configuredBuild: configuredBuild || null,
    updatedAt,
    reason,
    previewUrl: ready ? `/api/unity-preview/files/index.html?v=${updatedAt}` : null,
  };
}

export function setUnityWebglDir(dir) {
  const value = String(dir || "").trim();
  if (value) {
    const resolved = path.resolve(value);
    if (!path.isAbsolute(resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error("존재하는 WebGL 빌드 폴더를 입력하세요.");
    }
    if (!hasIndex(resolved)) throw new Error("선택한 폴더에 index.html이 없습니다.");
  }
  const cfg = readConfig();
  cfg.webglDir = value ? path.resolve(value) : "";
  cfg.updatedAt = Date.now();
  writeConfig(cfg);
  return getUnityPreviewStatus();
}

export function resolveUnityPreviewFile(requestPath) {
  const status = getUnityPreviewStatus();
  if (!status.ready || !status.buildDir) throw new Error(status.reason);
  const raw = decodeURIComponent(String(requestPath || "").replace(/^\/+/, "")) || "index.html";
  const root = fs.realpathSync(status.buildDir);
  const target = path.resolve(root, raw);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("허용되지 않은 미리보기 경로입니다.");
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error("미리보기 파일을 찾을 수 없습니다.");
  const real = fs.realpathSync(target);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error("미리보기 폴더 밖의 파일은 열 수 없습니다.");
  return real;
}
