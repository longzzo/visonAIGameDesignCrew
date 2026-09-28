const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;

const safeVersion = (value) => String(value || "unknown").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40) || "unknown";

function backupFileName({ currentVersion, targetVersion, now = new Date() }) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 17);
  return `VisionEngine-pre-update-v${safeVersion(currentVersion)}-to-v${safeVersion(targetVersion)}-${stamp}.vebackup`;
}

function requestJson({ port, pathname, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) request.destroy(new Error("백업 상태 응답이 너무 큽니다."));
      });
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400) { reject(new Error(`백업 상태 확인 실패 (HTTP ${response.statusCode || 0})`)); return; }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("백업 상태 응답을 읽을 수 없습니다.")); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("백업 상태 확인 시간 초과")));
    request.once("error", reject);
    request.end();
  });
}

async function downloadBackup({ port, temporaryFile, timeoutMs = REQUEST_TIMEOUT_MS }) {
  let byteCount = 0;
  const digest = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/api/backup/export", method: "GET" }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`업데이트 전 백업 생성 실패 (HTTP ${response.statusCode || 0})`));
        return;
      }
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      const declaredBytes = Number(response.headers["content-length"] || 0);
      if (!contentType.startsWith("application/vnd.vision-engine.backup")) {
        response.resume();
        reject(new Error("업데이트 전 백업 응답 형식이 올바르지 않습니다."));
        return;
      }
      if (declaredBytes > MAX_BACKUP_BYTES) {
        response.resume();
        reject(new Error("업데이트 전 백업이 300MB 제한을 초과했습니다."));
        return;
      }
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          byteCount += chunk.length;
          if (byteCount > MAX_BACKUP_BYTES) { callback(new Error("업데이트 전 백업이 300MB 제한을 초과했습니다.")); return; }
          digest.update(chunk);
          callback(null, chunk);
        },
      });
      const output = fs.createWriteStream(temporaryFile, { flags: "wx", mode: 0o600 });
      pipeline(response, limiter, output).then(resolve, reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("업데이트 전 백업 생성 시간 초과")));
    request.once("error", reject);
    request.end();
  });
  if (byteCount < 2) throw new Error("업데이트 전 백업 파일이 비어 있습니다.");
  const header = Buffer.alloc(2);
  const handle = fs.openSync(temporaryFile, "r");
  try { fs.readSync(handle, header, 0, 2, 0); }
  finally { fs.closeSync(handle); }
  if (header[0] !== 0x1f || header[1] !== 0x8b) throw new Error("업데이트 전 백업 GZIP 서명이 올바르지 않습니다.");
  return { bytes: byteCount, sha256: digest.digest("hex") };
}

async function createPreUpdateProjectBackup({
  userDataDir,
  runtimePort,
  currentVersion,
  targetVersion,
  remoteServerUrl = "",
  now = new Date(),
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (String(remoteServerUrl || "").trim()) return { created: false, reason: "remote-client" };
  const userData = path.resolve(String(userDataDir || ""));
  if (!path.isAbsolute(userData) || userData === path.parse(userData).root) throw new Error("업데이트 백업 저장 경로가 안전하지 않습니다.");
  const port = Number(runtimePort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("업데이트 백업 런타임 포트가 올바르지 않습니다.");
  const status = await requestJson({ port, pathname: "/api/backup/status", timeoutMs });
  const projects = Number(status?.projects || 0);
  if (projects <= 0) return { created: false, reason: "no-projects", projects: 0 };

  const directory = path.join(userData, "backups");
  fs.mkdirSync(directory, { recursive: true });
  const name = backupFileName({ currentVersion, targetVersion, now });
  const file = path.join(directory, name);
  const temporaryFile = `${file}.${process.pid}.partial`;
  try {
    const result = await downloadBackup({ port, temporaryFile, timeoutMs });
    fs.renameSync(temporaryFile, file);
    return { created: true, file, name, projects, ...result };
  } catch (error) {
    try { fs.rmSync(temporaryFile, { force: true }); } catch { /* noop */ }
    throw error;
  }
}

module.exports = {
  MAX_BACKUP_BYTES,
  backupFileName,
  createPreUpdateProjectBackup,
  safeVersion,
};
