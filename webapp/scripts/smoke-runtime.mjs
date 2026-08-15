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
  console.log(`✅ 런타임 smoke 통과: port=${port}`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once("close", resolve));
  fs.rmSync(data, { recursive: true, force: true });
}
