// 공식 CLI 구독 실행 어댑터.
// 토큰을 읽거나 프록시하지 않고, Claude Code/Codex가 자체 보관한 로그인만 사용한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const home = () => os.homedir();

const redacted = (value) => String(value || "")
  .replace(/\b(?:sk-(?:proj-)?|ghp_|github_pat_|nvapi-|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
  .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
  .replace(/\b(?:sk-ant-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]")
  .trim()
  .slice(-4_000);

/**
 * 구독 모드는 API 키·커스텀 엔드포인트·클라우드 공급자 변수를 상속하지 않는다.
 * CLI의 OS 보안 저장소/OAuth 로그인은 그대로 보존한다.
 */
export function subscriptionEnvironment(kind, source = process.env) {
  const env = {};
  const blocked = kind === "claude"
    ? [
        /^ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL)$/i,
        /^CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)$/i,
        /^(?:AWS_|AMAZON_BEDROCK_)/i,
        /^(?:GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT|CLOUD_ML_REGION|VERTEX_)/i,
        /^ANTHROPIC_(?:VERTEX|FOUNDRY|BEDROCK)_/i,
      ]
    : [
        /^OPENAI_(?:API_KEY|BASE_URL|API_BASE|ORGANIZATION|ORG_ID|PROJECT_ID)$/i,
        /^AZURE_OPENAI_/i,
      ];
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value !== "string" || blocked.some((pattern) => pattern.test(key))) continue;
    env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

function firstExisting(candidates) {
  return candidates.filter(Boolean).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || "";
}

function where(command) {
  if (process.platform !== "win32") return command;
  try {
    const result = spawnSync("where.exe", [command], { encoding: "utf-8", windowsHide: true, timeout: 4_000 });
    if (result.status !== 0) return "";
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

export function findClaudeExecutable() {
  const direct = firstExisting([
    process.env.VE_CLAUDE_CLI,
    process.platform === "win32" ? path.join(home(), ".local", "bin", "claude.exe") : "",
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "claude.cmd"),
    process.platform === "win32" ? path.join(home(), "AppData", "Roaming", "npm", "claude.cmd") : "",
    process.platform === "win32" ? path.join(home(), "AppData", "Local", "Programs", "claude", "claude.exe") : "",
  ]);
  return direct || where(process.platform === "win32" ? "claude.exe" : "claude");
}

export function findCodexExecutable() {
  const platform = {
    "win32:x64": ["codex-win32-x64", "x86_64-pc-windows-msvc", "codex.exe"],
    "win32:arm64": ["codex-win32-arm64", "aarch64-pc-windows-msvc", "codex.exe"],
    "darwin:x64": ["codex-darwin-x64", "x86_64-apple-darwin", "codex"],
    "darwin:arm64": ["codex-darwin-arm64", "aarch64-apple-darwin", "codex"],
    "linux:x64": ["codex-linux-x64", "x86_64-unknown-linux-musl", "codex"],
    "linux:arm64": ["codex-linux-arm64", "aarch64-unknown-linux-musl", "codex"],
  }[`${process.platform}:${process.arch}`];
  const roots = [
    process.env.VE_WEBAPP_ROOT,
    path.resolve(moduleDir, ".."),
  ].filter(Boolean);
  const bundled = platform
    ? roots.map((root) => path.join(root, "node_modules", "@openai", platform[0], "vendor", platform[1], "bin", platform[2]))
    : [];
  const direct = firstExisting([process.env.VE_CODEX_CLI, ...bundled]);
  return direct || where(process.platform === "win32" ? "codex.exe" : "codex");
}

function capture(command, args, { env, timeoutMs = 5_000, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: String(error?.message || error), timedOut: false });
      return;
    }
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (text) => { if (stdout.length < 100_000) stdout += text; });
    child.stderr?.on("data", (text) => { if (stderr.length < 100_000) stderr += text; });
    child.once("error", (error) => finish({ code: null, stdout, stderr: String(error?.message || error), timedOut: false }));
    child.once("close", (code) => finish({ code, stdout, stderr, timedOut: false }));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 이미 종료됨 */ }
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
  });
}

let statusCache = { at: 0, value: null, inFlight: null };

export function invalidateSubscriptionStatus() {
  statusCache = { at: 0, value: null, inFlight: null };
}

export async function checkClaudeSubscription() {
  const executable = findClaudeExecutable();
  if (!executable) return { installed: false, authenticated: false, subscription: false, version: "", detail: "Claude Code CLI가 없습니다." };
  const env = subscriptionEnvironment("claude");
  const [versionResult, authResult] = await Promise.all([
    capture(executable, ["--version"], { env }),
    capture(executable, ["auth", "status"], { env }),
  ]);
  let status = {};
  try { status = JSON.parse(String(authResult.stdout || "").trim()); } catch { /* 비정상 출력은 아래에서 안전하게 실패 */ }
  const authenticated = status?.loggedIn === true && authResult.code === 0;
  const authMethod = String(status?.authMethod || "").trim().slice(0, 40);
  const subscriptionType = String(status?.subscriptionType || "").trim().slice(0, 40);
  const subscription = authenticated && (
    Boolean(subscriptionType) || /^(?:claude\.ai|oauth_token)$/i.test(authMethod)
  ) && !/api.?key|console/i.test(authMethod);
  const version = String(versionResult.stdout || versionResult.stderr || "").trim().split(/\s+/)[0].slice(0, 40);
  const detail = subscription
    ? `Claude 구독 로그인됨${subscriptionType ? ` · ${subscriptionType}` : ""}`
    : authenticated
      ? "로그인됨 · 구독 계정인지 확인이 필요합니다."
      : authResult.timedOut ? "로그인 상태 확인 시간 초과" : "Claude 구독 로그인 필요";
  return { installed: true, authenticated, subscription, version, authMethod, subscriptionType, detail };
}

export async function checkCodexSubscription() {
  const executable = findCodexExecutable();
  if (!executable) return { installed: false, authenticated: false, subscription: false, version: "", detail: "Codex CLI가 없습니다." };
  const env = subscriptionEnvironment("codex");
  const [versionResult, authResult] = await Promise.all([
    capture(executable, ["--version"], { env }),
    capture(executable, ["login", "status"], { env }),
  ]);
  const output = `${authResult.stdout || ""}\n${authResult.stderr || ""}`.trim();
  const authenticated = authResult.code === 0;
  const subscription = authenticated && /ChatGPT/i.test(output) && !/API key/i.test(output);
  const version = String(versionResult.stdout || versionResult.stderr || "").trim().replace(/^codex-cli\s+/i, "").split(/\s+/)[0].slice(0, 40);
  const detail = subscription
    ? "ChatGPT 구독 로그인됨"
    : authenticated ? "로그인됨 · ChatGPT 구독 로그인이 아닙니다." : authResult.timedOut ? "로그인 상태 확인 시간 초과" : "ChatGPT 로그인 필요";
  return { installed: true, authenticated, subscription, version, authMethod: subscription ? "chatgpt" : authenticated ? "other" : "none", detail };
}

export async function getSubscriptionStatus({ maxAgeMs = 5_000 } = {}) {
  const now = Date.now();
  if (statusCache.value && now - statusCache.at < maxAgeMs) return statusCache.value;
  if (statusCache.inFlight) return statusCache.inFlight;
  statusCache.inFlight = Promise.all([checkClaudeSubscription(), checkCodexSubscription()])
    .then(([claude, codex]) => {
      const value = { claude, codex, ready: claude.subscription || codex.subscription };
      statusCache = { at: Date.now(), value, inFlight: null };
      return value;
    })
    .catch((error) => {
      statusCache = { at: 0, value: null, inFlight: null };
      throw error;
    });
  return statusCache.inFlight;
}

const MAX_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.VE_SUBSCRIPTION_CONCURRENCY || 2)));
let active = 0;
const queue = [];

/** 다중 에이전트 팬아웃이 구독 CLI를 한꺼번에 수십 개 띄우지 않게 제한한다. */
export async function withSubscriptionSlot(work) {
  if (active >= MAX_CONCURRENCY) await new Promise((resolve) => queue.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

/** Claude Code를 읽기 전용·무도구 모드로 실행한다. */
export async function runClaudeSubscription({ prompt, cwd, onStep, signal, allowReadTools = false }) {
  const status = await checkClaudeSubscription();
  if (!status.subscription) throw new Error(status.detail);
  const executable = findClaudeExecutable();
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--safe-mode",
    "--permission-mode", "plan",
    "--tools", allowReadTools ? "Read,Glob,Grep" : "",
    "--no-session-persistence",
  ];
  const timeoutMs = Math.max(30_000, Number(process.env.VE_CLAUDE_TIMEOUT_MS || 420_000));
  return await new Promise((resolve, reject) => {
    let child;
    let buffer = "";
    let stderr = "";
    let final = "";
    let resultError = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => {
      try { child?.kill(); } catch { /* noop */ }
      finish(new Error("Claude 구독 작업이 중단되었습니다."));
    };
    const emitLine = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event?.type === "assistant") {
        for (const block of event?.message?.content || []) {
          if (block?.type === "text" && String(block.text || "").trim()) {
            final = String(block.text).trim();
            onStep?.({ kind: "say", text: final });
          } else if (block?.type === "tool_use") {
            onStep?.({ kind: "tool", server: "claude", name: String(block.name || "read"), args: block.input || {} });
          }
        }
      } else if (event?.type === "result") {
        if (String(event.result || "").trim()) final = String(event.result).trim();
        if (event.is_error) resultError = String(event.result || event.error || "Claude 실행 실패");
      }
    };
    try {
      child = spawn(executable, args, {
        cwd,
        env: subscriptionEnvironment("claude"),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (text) => {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) emitLine(line);
    });
    child.stderr.on("data", (text) => { if (stderr.length < 100_000) stderr += text; });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      emitLine(buffer);
      const errorText = redacted(resultError || stderr);
      if (code !== 0 || resultError) {
        finish(new Error(errorText || `Claude Code 종료 코드 ${code}`));
        return;
      }
      finish(null, { ok: true, final: final || "Claude가 최종 본문을 반환하지 않았습니다.", empty: !final });
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish(new Error("Claude 구독 작업 시간이 초과되었습니다."));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(String(prompt || ""), "utf-8");
  });
}
