import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const FORMAT = "vision-engine-project-backup";
const SCHEMA_VERSION = 1;
const MAX_FILES = 20_000;
const MAX_PROJECTS = 200;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MAX_JSON_BYTES = 384 * 1024 * 1024;
const SAFE_PROJECT = /^[a-z0-9][a-z0-9-]{0,40}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || process.env.VE_REPO_ROOT || path.resolve(process.cwd(), ".."));
const projectsRoot = (root) => path.join(path.resolve(root), "workspace", "projects");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function localRequest(req) {
  const ip = String(req?.socket?.remoteAddress || "");
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
}

function safeRelative(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !normalized
    || normalized.length > 500
    || normalized.startsWith("/")
    || /^[a-z]:/i.test(normalized)
    || parts.some((part) => !part || part === "." || part === ".." || part.length > 160 || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part))
  ) throw new Error("백업에 안전하지 않은 파일 경로가 있습니다.");
  return parts.join("/");
}

function projectEntries(root, projectId = "") {
  const base = projectsRoot(root);
  if (!fs.existsSync(base)) return [];
  if (projectId) {
    if (!SAFE_PROJECT.test(projectId)) throw new Error("잘못된 프로젝트 id입니다.");
    const directory = path.join(base, projectId);
    if (!fs.existsSync(path.join(directory, "project.json"))) throw new Error("프로젝트를 찾지 못했습니다.");
    return [{ id: projectId, directory }];
  }
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_PROJECT.test(entry.name) && fs.existsSync(path.join(base, entry.name, "project.json")))
    .map((entry) => ({ id: entry.name, directory: path.join(base, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function walkProject(directory) {
  const output = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "desktop.ini" || entry.name === ".DS_Store") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  return output.sort((a, b) => a.localeCompare(b));
}

export function backupStatus(root = dataRoot()) {
  let files = 0;
  let bytes = 0;
  const projects = projectEntries(root);
  for (const project of projects) {
    for (const file of walkProject(project.directory)) {
      files += 1;
      bytes += fs.statSync(file).size;
    }
  }
  return { projects: projects.length, files, bytes, maxBytes: MAX_TOTAL_BYTES };
}

export function createProjectBackup({ root = dataRoot(), projectId = "", now = new Date() } = {}) {
  const entries = projectEntries(root, projectId);
  if (!entries.length) throw new Error("백업할 프로젝트가 없습니다.");
  if (entries.length > MAX_PROJECTS) throw new Error(`프로젝트는 한 번에 ${MAX_PROJECTS}개까지 백업할 수 있습니다.`);
  let fileCount = 0;
  let totalBytes = 0;
  const projects = entries.map(({ id, directory }) => {
    const files = walkProject(directory).map((absolute) => {
      fileCount += 1;
      if (fileCount > MAX_FILES) throw new Error(`백업 파일은 ${MAX_FILES.toLocaleString()}개까지 지원합니다.`);
      const relative = safeRelative(path.relative(directory, absolute));
      const data = fs.readFileSync(absolute);
      if (data.length > MAX_FILE_BYTES) throw new Error(`${relative}: 단일 파일 64MB 제한을 초과했습니다.`);
      totalBytes += data.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("프로젝트 데이터가 백업 한도 256MB를 초과했습니다.");
      return { path: relative, bytes: data.length, sha256: sha256(data), data: data.toString("base64") };
    });
    return { id, files };
  });
  const document = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now.toISOString(),
    projectCount: projects.length,
    fileCount,
    totalBytes,
    projects,
  };
  const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(document)), { level: 9 });
  return { buffer, manifest: { ...document, projects: projects.map((project) => ({ id: project.id, files: project.files.length })) } };
}

function decodeBackup(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ARCHIVE_BYTES) throw new Error("백업 파일 크기가 올바르지 않습니다.");
  let document;
  try {
    document = JSON.parse(zlib.gunzipSync(buffer, { maxOutputLength: MAX_JSON_BYTES }).toString("utf-8"));
  } catch {
    throw new Error("Vision Engine 백업 파일을 읽을 수 없습니다.");
  }
  if (document?.format !== FORMAT || document?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(document?.projects)) {
    throw new Error("지원하지 않는 백업 형식입니다.");
  }
  if (!document.projects.length || document.projects.length > MAX_PROJECTS) throw new Error("백업의 프로젝트 수가 올바르지 않습니다.");
  return document;
}

function validateBackup(document) {
  const seenProjects = new Set();
  let fileCount = 0;
  let totalBytes = 0;
  const projects = document.projects.map((project) => {
    const id = String(project?.id || "");
    if (!SAFE_PROJECT.test(id) || seenProjects.has(id) || !Array.isArray(project?.files)) throw new Error("백업의 프로젝트 정보가 올바르지 않습니다.");
    seenProjects.add(id);
    const seenFiles = new Set();
    const files = project.files.map((file) => {
      fileCount += 1;
      if (fileCount > MAX_FILES) throw new Error("백업 파일 수가 허용 범위를 초과했습니다.");
      const relative = safeRelative(file?.path);
      if (seenFiles.has(relative)) throw new Error("백업에 중복된 파일 경로가 있습니다.");
      seenFiles.add(relative);
      const encoded = String(file?.data || "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`${relative}: 파일 데이터가 손상되었습니다.`);
      const data = Buffer.from(encoded, "base64");
      if (data.length > MAX_FILE_BYTES || data.length !== Number(file?.bytes) || sha256(data) !== String(file?.sha256 || "")) {
        throw new Error(`${relative}: 파일 무결성 검증에 실패했습니다.`);
      }
      totalBytes += data.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("복원 데이터가 허용 범위를 초과했습니다.");
      return { relative, data };
    });
    if (!seenFiles.has("project.json")) throw new Error(`${id}: project.json이 없습니다.`);
    const metadata = files.find((file) => file.relative === "project.json");
    try {
      const parsed = JSON.parse(metadata.data.toString("utf-8"));
      if (!String(parsed?.name || "").trim()) throw new Error();
    } catch {
      throw new Error(`${id}: 프로젝트 정보가 손상되었습니다.`);
    }
    return { id, files };
  });
  return { projects, fileCount, totalBytes };
}

function uniqueRestoreId(base, destinationRoot, suffix, reserved) {
  if (!fs.existsSync(path.join(destinationRoot, base)) && !reserved.has(base)) return base;
  const stem = base.slice(0, 24).replace(/-+$/, "") || "project";
  for (let index = 0; index < 1000; index += 1) {
    const candidate = `${stem}-restore-${suffix}${index ? `-${index}` : ""}`.slice(0, 41).replace(/-+$/, "");
    if (SAFE_PROJECT.test(candidate) && !fs.existsSync(path.join(destinationRoot, candidate)) && !reserved.has(candidate)) return candidate;
  }
  throw new Error("복원 프로젝트 id를 만들 수 없습니다.");
}

export function restoreProjectBackup(buffer, { root = dataRoot(), now = new Date() } = {}) {
  const document = decodeBackup(buffer);
  const validated = validateBackup(document);
  const destinationRoot = projectsRoot(root);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const stageParent = path.join(path.resolve(root), "workspace", ".restore-staging");
  fs.mkdirSync(stageParent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(stageParent, "restore-"));
  const suffix = now.getTime().toString(36).slice(-7);
  const reserved = new Set();
  const plan = validated.projects.map((project) => {
    const targetId = uniqueRestoreId(project.id, destinationRoot, suffix, reserved);
    reserved.add(targetId);
    return { ...project, targetId, conflict: targetId !== project.id };
  });
  const completed = [];
  try {
    for (const project of plan) {
      const stagedProject = path.join(stage, project.targetId);
      for (const file of project.files) {
        const output = path.join(stagedProject, ...file.relative.split("/"));
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, file.data);
      }
      const metadataPath = path.join(stagedProject, "project.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      if (project.conflict) metadata.name = `${String(metadata.name).trim()} (복원본)`;
      metadata.importedAt = now.getTime();
      metadata.sourceProjectId = project.id;
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
    }
    for (const project of plan) {
      const destination = path.join(destinationRoot, project.targetId);
      fs.renameSync(path.join(stage, project.targetId), destination);
      completed.push(destination);
    }
  } catch (error) {
    for (const destination of completed) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return {
    ok: true,
    imported: plan.map((project) => ({ sourceId: project.id, id: project.targetId, copied: project.conflict })),
    files: validated.fileCount,
    bytes: validated.totalBytes,
    createdAt: String(document.createdAt || ""),
  };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) {
        settled = true;
        reject(new Error("백업 파일은 300MB까지 복원할 수 있습니다."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

export function backupApiPlugin() {
  return {
    name: "vision-engine-backup-api",
    configureServer(server) {
      server.middlewares.use("/api/backup", (req, res) => {
        void (async () => {
          res.setHeader("Cache-Control", "no-store");
          try {
            if (!localRequest(req)) {
              res.statusCode = 403;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: "백업 기능은 서버 PC에서만 사용할 수 있습니다." }));
              return;
            }
            const url = new URL(req.url || "/", "http://local");
            const action = url.pathname.replace(/\/+$/, "") || "/";
            if (req.method === "GET" && (action === "/" || action === "/status")) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, ...backupStatus() }));
              return;
            }
            if (req.method === "GET" && action === "/export") {
              const projectId = url.searchParams.get("project") || "";
              const result = createProjectBackup({ projectId });
              const stamp = new Date().toISOString().slice(0, 10);
              const scope = projectId || "all-projects";
              res.setHeader("Content-Type", "application/vnd.vision-engine.backup");
              res.setHeader("Content-Disposition", `attachment; filename="VisionEngine-${scope}-${stamp}.vebackup"`);
              res.setHeader("Content-Length", String(result.buffer.length));
              res.end(result.buffer);
              return;
            }
            if (req.method === "POST" && action === "/import") {
              const result = restoreProjectBackup(await readRawBody(req));
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(result));
              return;
            }
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "지원하지 않는 백업 요청입니다." }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 300) }));
          }
        })();
      });
    },
  };
}
