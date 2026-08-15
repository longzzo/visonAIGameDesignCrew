import connect from "connect";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sirv from "sirv";
import { fileURLToPath } from "node:url";
import { visionApiPlugins } from "../vite.config";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const webappRoot = process.env.VE_WEBAPP_ROOT ? path.resolve(process.env.VE_WEBAPP_ROOT) : path.resolve(runtimeDir, "..");
const distDir = path.join(webappRoot, "dist");
const indexFile = path.join(distDir, "index.html");
const host = process.env.VE_RUNTIME_HOST || "127.0.0.1";
const port = Math.max(1, Number(process.env.VE_RUNTIME_PORT) || 5199);

if (!fs.existsSync(indexFile)) {
  throw new Error(`웹앱 빌드를 찾지 못했습니다: ${indexFile}`);
}

const app = connect();
const server = http.createServer(app);
const adapter = { middlewares: app, httpServer: server } as any;

for (const plugin of visionApiPlugins()) {
  await plugin.configureServer?.(adapter);
}

app.use(sirv(distDir, { etag: true, single: false, dev: false }));
app.use((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexFile).pipe(res);
});

server.listen(port, host, () => {
  console.log(`✅ Vision Engine 런타임: http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
