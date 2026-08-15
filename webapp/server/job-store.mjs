import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const safeProject = (id) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ""));
const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || process.env.VE_REPO_ROOT || path.resolve(process.cwd(), ".."));
const jobFile = (project) => path.join(dataRoot(), "workspace", "projects", project, "jobs.json");
const activeJobs = new Map();
const activeKey = (project, id) => `${project}:${id}`;
const ACTIVE_TTL_MS = 30_000;

function readJobs(project) {
  try {
    const doc = JSON.parse(fs.readFileSync(jobFile(project), "utf-8"));
    return Array.isArray(doc.jobs) ? doc.jobs : [];
  } catch {
    return [];
  }
}

function writeJobs(project, jobs) {
  const file = jobFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, jobs: jobs.slice(-200) }, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

export function createJob(project, input) {
  const jobs = readJobs(project);
  const now = Date.now();
  const job = {
    id: `job-${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
    type: "orchestration",
    status: "running",
    createdAt: now,
    updatedAt: now,
    request: String(input?.request || "").slice(0, 20_000),
    poolIds: Array.isArray(input?.poolIds) ? input.poolIds.map(String).slice(0, 100) : [],
    autoRoute: Boolean(input?.autoRoute),
    completedAgents: [],
  };
  jobs.push(job);
  writeJobs(project, jobs);
  activeJobs.set(activeKey(project, job.id), now);
  return job;
}

export function updateJob(project, id, patch) {
  const jobs = readJobs(project);
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) throw new Error("작업을 찾지 못했습니다");
  const allowed = {};
  if (["running", "completed", "failed", "stopped", "interrupted"].includes(patch?.status)) allowed.status = patch.status;
  if (Array.isArray(patch?.completedAgents)) allowed.completedAgents = patch.completedAgents.map(String).slice(0, 100);
  if (patch?.error !== undefined) allowed.error = String(patch.error).slice(0, 1000);
  jobs[index] = { ...jobs[index], ...allowed, updatedAt: Date.now() };
  writeJobs(project, jobs);
  if (jobs[index].status === "running") activeJobs.set(activeKey(project, id), Date.now());
  else activeJobs.delete(activeKey(project, id));
  return jobs[index];
}

export function latestRecoverableJob(project) {
  const jobs = readJobs(project);
  let changed = false;
  for (const job of jobs) {
    const key = activeKey(project, job.id);
    const recentlyActive = Date.now() - (activeJobs.get(key) || 0) < ACTIVE_TTL_MS;
    if (job.status === "running" && !recentlyActive) {
      activeJobs.delete(key);
      job.status = "interrupted";
      job.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) writeJobs(project, jobs);
  return [...jobs].reverse().find((job) => job.status === "interrupted" || job.status === "failed") || null;
}

function readBody(req, max = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > max) reject(new Error("요청이 너무 큽니다"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function remoteWriteBlocked(req) {
  if ((process.env.VE_REMOTE_MODE || "full").toLowerCase() !== "readonly") return false;
  const ip = String(req?.socket?.remoteAddress || "");
  return !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
}

export function jobStorePlugin() {
  return {
    name: "vision-engine-job-store",
    configureServer(server) {
      server.middlewares.use("/api/jobs", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            const url = new URL(req.url || "/", "http://local");
            const project = url.searchParams.get("project") || "";
            if (!safeProject(project)) throw new Error("잘못된 프로젝트 id");
            if (req.method === "GET") {
              res.end(JSON.stringify({ ok: true, job: latestRecoverableJob(project) }));
              return;
            }
            if (req.method === "POST") {
              if (remoteWriteBlocked(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "원격 읽기전용 모드입니다" }));
                return;
              }
              const body = JSON.parse((await readBody(req)) || "{}");
              const job = body.id ? updateJob(project, String(body.id), body) : createJob(project, body);
              res.end(JSON.stringify({ ok: true, job }));
              return;
            }
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: "GET 또는 POST만 허용됩니다" }));
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 200) }));
          }
        })();
      });
    },
  };
}
