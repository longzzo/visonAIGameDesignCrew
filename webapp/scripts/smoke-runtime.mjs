import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const webapp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(webapp, "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-smoke-"));

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});

const child = spawn(process.execPath, [path.join(webapp, "dist-server", "runtime.mjs")], {
  cwd: webapp,
  windowsHide: true,
  env: {
    ...process.env,
    VE_REPO_ROOT: repo,
    VE_WEBAPP_ROOT: webapp,
    VE_DATA_ROOT: data,
    VE_OPENCLAW_HOME: data,
    VE_RUNTIME_HOST: "127.0.0.1",
    VE_RUNTIME_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));

try {
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/api/gateway/status`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, `런타임 시작 실패:\n${logs}`);

  const root = await fetch(base);
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /text\/html/);

  const gateway = await (await fetch(`${base}/api/gateway/status`)).json();
  assert.equal(gateway.ok, true);
  assert.equal(typeof gateway.connected, "boolean");

  const agents = await (await fetch(`${base}/api/gateway/agents`)).json();
  assert.equal(agents.ok, true);
  assert.ok(Array.isArray(agents.agents));

  const projects = await fetch(`${base}/api/projects`);
  assert.equal(projects.status, 200);
  const createdResponse = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "백업 smoke 프로젝트" }),
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.ok, true);

  const backupStatus = await (await fetch(`${base}/api/backup/status`)).json();
  assert.equal(backupStatus.ok, true);
  assert.equal(backupStatus.projects, 1);
  const backupResponse = await fetch(`${base}/api/backup/export`);
  assert.equal(backupResponse.status, 200);
  assert.match(backupResponse.headers.get("content-type") ?? "", /vision-engine\.backup/);
  const restoredResponse = await fetch(`${base}/api/backup/import`, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.vision-engine.backup" },
    body: await backupResponse.arrayBuffer(),
  });
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json();
  assert.equal(restored.ok, true);
  assert.equal(restored.imported.length, 1);
  assert.equal(restored.imported[0].copied, true);

  const readiness = await (await fetch(`${base}/api/readiness`, { signal: AbortSignal.timeout(10_000) })).json();
  assert.equal(readiness.ok, true);
  assert.equal(typeof readiness.codex.authenticated, "boolean");
  assert.equal(readiness.desktop, false);
  console.log(`✅ 런타임 smoke 통과: port=${port}`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once("close", resolve));
  fs.rmSync(data, { recursive: true, force: true });
}
