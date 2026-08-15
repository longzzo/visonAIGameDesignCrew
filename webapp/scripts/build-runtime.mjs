import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webapp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(webapp, "server", "runtime-entry.ts")],
  outfile: path.join(webapp, "dist-server", "runtime.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  packages: "external",
  banner: { js: "import { createRequire as __veCreateRequire } from 'node:module'; const require = __veCreateRequire(import.meta.url);" },
  define: { "process.env.NODE_ENV": '"production"' }
});

console.log("✅ 독립 실행 서버 빌드: dist-server/runtime.mjs");
