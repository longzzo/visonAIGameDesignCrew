import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "config", "agents.manifest.json");
const policyPath = path.join(root, "config", "model-policy.json");
const openclawPath = path.join(root, "config", "openclaw.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));
const config = JSON.parse(fs.readFileSync(openclawPath, "utf-8"));

const agents = Array.isArray(manifest.agents) ? manifest.agents : [];
const ids = new Set();
for (const agent of agents) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(agent.id)) throw new Error(`잘못된 에이전트 id: ${agent.id}`);
  if (ids.has(agent.id)) throw new Error(`중복 에이전트 id: ${agent.id}`);
  ids.add(agent.id);
}

const retired = (model) =>
  typeof model === "string" && policy.retiredModelPatterns.some((needle) => model.includes(needle));
const existing = new Map((config.agents?.list ?? []).map((agent) => [agent.id, agent]));
const fallbackTools = existing.get("scenario")?.tools ?? existing.get("pm")?.tools ?? { deny: [] };

config.agents ??= {};
config.agents.list = agents.map((agent) => {
  const before = existing.get(agent.id) ?? {};
  const configured = before.model;
  const model = !configured || retired(configured) ? policy.roles[agent.modelRole] ?? policy.localFallback : configured;
  return {
    ...before,
    id: agent.id,
    name: agent.name,
    ...(agent.default ? { default: true } : {}),
    workspace: `{{REPO}}\\agents\\${agent.id}`,
    identity: { name: agent.name, emoji: agent.emoji },
    model,
    tools: before.tools ?? fallbackTools,
  };
});

const defaultModel = config.agents.defaults?.model?.primary;
if (!defaultModel || retired(defaultModel)) {
  config.agents.defaults ??= {};
  config.agents.defaults.model = { ...(config.agents.defaults.model ?? {}), primary: policy.roles.planner };
}

for (const provider of Object.values(config.models?.providers ?? {})) {
  if (!Array.isArray(provider.models)) continue;
  provider.models = provider.models.filter((model) => !retired(model?.id));
}

fs.writeFileSync(openclawPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
console.log(`✅ 에이전트 manifest 동기화 완료: ${agents.length}명`);
