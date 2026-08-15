import fs from "node:fs";
import path from "node:path";

const dataRoot = () => path.resolve(process.env.VE_DATA_ROOT || process.env.VE_REPO_ROOT || path.resolve(process.cwd(), ".."));
const usageFile = () => path.join(dataRoot(), "config", "usage-log.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

const emptyTotal = () => ({ input: 0, output: 0, calls: 0, estimated: false });

export function summarizeUsage(entries, now = Date.now()) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  const day = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - day + 1);
  const totals = { today: emptyTotal(), week: emptyTotal(), all: emptyTotal() };
  for (const raw of Array.isArray(entries) ? entries : []) {
    const ts = Number(raw?.ts) || 0;
    const add = (target) => {
      target.input += Math.max(0, Number(raw?.input) || 0);
      target.output += Math.max(0, Number(raw?.output) || 0);
      target.calls += Math.max(0, Number(raw?.calls) || 0);
      target.estimated ||= Boolean(raw?.estimated);
    };
    add(totals.all);
    if (ts >= weekStart.getTime()) add(totals.week);
    if (ts >= dayStart.getTime()) add(totals.today);
  }
  return totals;
}

export function appendUsage(entry, file = usageFile()) {
  const current = readJson(file, { version: 1, entries: [] });
  const entries = Array.isArray(current.entries) ? current.entries : [];
  entries.push({
    ts: Number(entry?.ts) || Date.now(),
    model: String(entry?.model || "unknown").slice(0, 160),
    input: Math.max(0, Number(entry?.input) || 0),
    output: Math.max(0, Number(entry?.output) || 0),
    calls: Math.max(1, Number(entry?.calls) || 1),
    estimated: Boolean(entry?.estimated),
  });
  current.entries = entries.slice(-50_000);
  atomicWrite(file, current);
  return summarizeUsage(current.entries);
}

function readBody(req, max = 64 * 1024) {
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

export function usageStorePlugin() {
  return {
    name: "vision-engine-usage-store",
    configureServer(server) {
      server.middlewares.use("/api/usage", (req, res) => {
        void (async () => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            if (req.method === "GET") {
              const doc = readJson(usageFile(), { entries: [] });
              res.end(JSON.stringify({ ok: true, ...summarizeUsage(doc.entries) }));
              return;
            }
            if (req.method === "POST") {
              if (remoteWriteBlocked(req)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ ok: false, error: "원격 읽기전용 모드입니다" }));
                return;
              }
              const body = JSON.parse((await readBody(req)) || "{}");
              res.end(JSON.stringify({ ok: true, ...appendUsage(body) }));
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
