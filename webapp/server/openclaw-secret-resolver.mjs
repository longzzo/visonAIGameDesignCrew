import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeModules = new Map();

export const isOpenClawSecretRef = (value) =>
  !!value && typeof value === "object"
  && ["env", "file", "exec", "store"].includes(value.source)
  && typeof value.provider === "string" && value.provider.length > 0
  && typeof value.id === "string" && value.id.length > 0;

function packageRootFromEntry(entry) {
  if (!entry) return "";
  let current = path.resolve(entry);
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    return "";
  }
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = path.join(current, "package.json");
    try {
      if (JSON.parse(fs.readFileSync(manifest, "utf-8"))?.name === "openclaw") return current;
    } catch { /* 다음 상위 경로 확인 */ }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

export function findOpenClawPackageRoot({ env = process.env, home = os.homedir() } = {}) {
  const candidates = [
    env.VE_OPENCLAW_ROOT,
    packageRootFromEntry(env.VE_OPENCLAW_ENTRY),
    env.APPDATA && path.join(env.APPDATA, "npm", "node_modules", "openclaw"),
    path.join(home, "AppData", "Roaming", "npm", "node_modules", "openclaw"),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf-8"))?.name === "openclaw"; }
    catch { return false; }
  }) || "";
}

async function loadOpenClawSecretRuntime({ env = process.env, home } = {}) {
  const root = findOpenClawPackageRoot({ env, home });
  if (!root) throw new Error("OpenClaw 설치 경로를 찾지 못했습니다.");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
  const exported = manifest?.exports?.["./plugin-sdk/secret-ref-runtime"];
  const relative = typeof exported === "string" ? exported : exported?.default;
  if (!relative || typeof relative !== "string") throw new Error("OpenClaw SecretRef 런타임을 지원하지 않는 버전입니다.");
  const moduleFile = path.resolve(root, relative);
  if (!moduleFile.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(moduleFile)) {
    throw new Error("OpenClaw SecretRef 런타임 경로가 올바르지 않습니다.");
  }
  let loaded = runtimeModules.get(moduleFile);
  if (!loaded) {
    loaded = import(pathToFileURL(moduleFile).href);
    runtimeModules.set(moduleFile, loaded);
  }
  try {
    return await loaded;
  } catch (error) {
    if (runtimeModules.get(moduleFile) === loaded) runtimeModules.delete(moduleFile);
    throw error;
  }
}

/**
 * 평문 또는 OpenClaw SecretRef를 서버 메모리 안에서만 해석한다.
 * 반환값은 로그·HTTP 응답·브라우저로 전달하면 안 된다.
 */
export async function resolveOpenClawSecretInput(value, config, options = {}) {
  if (typeof value === "string") {
    const direct = value.trim();
    if (!direct) throw new Error("OpenClaw 비밀값이 비어 있습니다.");
    return direct;
  }
  if (!isOpenClawSecretRef(value)) throw new Error("지원하지 않는 OpenClaw 비밀값 형식입니다.");
  const runtime = await (options.loadRuntime || loadOpenClawSecretRuntime)({
    env: options.env || process.env,
    home: options.home,
  });
  if (typeof runtime?.resolveSecretRefValues !== "function") {
    throw new Error("OpenClaw SecretRef 해석기를 사용할 수 없습니다.");
  }
  const resolved = await runtime.resolveSecretRefValues([value], {
    config,
    env: options.env || process.env,
  });
  const secret = resolved?.values?.().next?.().value;
  if (typeof secret !== "string" || !secret.trim()) throw new Error("OpenClaw SecretRef를 해석하지 못했습니다.");
  return secret;
}
