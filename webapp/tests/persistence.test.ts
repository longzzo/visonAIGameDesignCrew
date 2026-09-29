import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendUsage, summarizeUsage } from "../server/usage-store.mjs";
import { createJob, latestRecoverableJob, updateJob } from "../server/job-store.mjs";
import { localFallbackModel, resolveProvider } from "../server/dev-provider.mjs";
import { importLegacyData, openClawAgentCount, resolveAiRuntime, resolveCodexWorkdir, setAiRuntime, setCodexWorkdir } from "../server/readiness.mjs";
import { subscriptionEnvironment } from "../server/subscription-agents.mjs";
import { getUnityPreviewStatus, resolveUnityPreviewFile, setUnityWebglDir } from "../server/unity-preview.mjs";

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.VE_DATA_ROOT;
  delete process.env.VE_UNITY_DIR;
});

describe("개발 모델 제공자 어댑터", () => {
  it("모델 접두사로 제공자와 모델 id를 분리한다", () => {
    const provider = resolveProvider("github/openai/gpt-5", {
      models: { providers: { github: { baseUrl: "https://models.example/v1/", apiKey: "test", models: [] } } },
    });
    expect(provider).toMatchObject({ id: "github", modelId: "openai/gpt-5", baseUrl: "https://models.example/v1" });
  });

  it("구독 모드는 API 과금 변수는 제거하고 공식 CLI OAuth 상태는 보존한다", () => {
    expect(subscriptionEnvironment("claude", {
      PATH: "bin",
      ANTHROPIC_API_KEY: "paid-key",
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_ACCESS_KEY_ID: "cloud-key",
      CLAUDE_CODE_OAUTH_TOKEN: "subscription-oauth",
    })).toEqual({ PATH: "bin", CLAUDE_CODE_OAUTH_TOKEN: "subscription-oauth" });
    expect(subscriptionEnvironment("codex", {
      PATH: "bin",
      OPENAI_API_KEY: "paid-key",
      OPENAI_BASE_URL: "https://proxy.example",
    })).toEqual({ PATH: "bin" });
  });

  it("Ollama의 OpenAI 호환 v1 경로와 로컬 키를 자동 보완한다", () => {
    const provider = resolveProvider("ollama/qwen3.5:4b", {
      models: { providers: { ollama: { baseUrl: "http://127.0.0.1:11434", api: "ollama", models: [] } } },
    });
    expect(provider).toMatchObject({ baseUrl: "http://127.0.0.1:11434/v1", key: "ollama-local", modelId: "qwen3.5:4b" });
  });

  it("구독 실패 뒤에는 정책에 지정된 로컬 무료 모델을 사용한다", () => {
    expect(localFallbackModel()).toBe("qwen3.5:4b");
  });
});

describe("사용량 영속 집계", () => {
  it("오늘·이번 주·전체 구간을 분리한다", () => {
    const now = new Date("2026-08-15T12:00:00+09:00").getTime();
    const totals = summarizeUsage([
      { ts: now - 60_000, input: 10, output: 20, calls: 1 },
      { ts: now - 3 * 86_400_000, input: 30, output: 40, calls: 2, estimated: true },
      { ts: now - 30 * 86_400_000, input: 50, output: 60, calls: 3 },
    ], now) as any;
    expect(totals.today.calls).toBe(1);
    expect(totals.week.calls).toBe(3);
    expect(totals.all.calls).toBe(6);
    expect(totals.all.estimated).toBe(true);
  });

  it("호출 기록을 원자적으로 누적한다", () => {
    const file = path.join(tempDir(), "usage.json");
    appendUsage({ model: "ollama/qwen3.5:4b", input: 7, output: 11, calls: 1 }, file);
    const totals = appendUsage({ model: "nvidia/openai/gpt-oss-120b", input: 3, output: 5, calls: 1 }, file) as any;
    expect(totals.all).toMatchObject({ input: 10, output: 16, calls: 2 });
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).entries).toHaveLength(2);
  });
});

describe("회의 작업 체크포인트", () => {
  it("실행 중 종료된 작업을 재시작 가능한 중단 상태로 복원한다", () => {
    const root = tempDir();
    process.env.VE_DATA_ROOT = root;
    const dir = path.join(root, "workspace", "projects", "sample");
    fs.mkdirSync(dir, { recursive: true });
    const job = { id: "job-crashed", status: "running", request: "전투 밸런스 검토", poolIds: ["balance"], autoRoute: true };
    fs.writeFileSync(path.join(dir, "jobs.json"), JSON.stringify({ version: 1, jobs: [job] }));
    const recovered = latestRecoverableJob("sample");
    expect(recovered).toMatchObject({ id: job.id, status: "interrupted", request: "전투 밸런스 검토" });
  });

  it("정상 완료된 작업은 복원 대상으로 노출하지 않는다", () => {
    process.env.VE_DATA_ROOT = tempDir();
    const job = createJob("sample", { request: "완료 작업" });
    updateJob("sample", job.id, { status: "completed" });
    expect(latestRecoverableJob("sample")).toBeNull();
  });
});

describe("PC 앱 데이터 이전과 Codex 작업 폴더", () => {
  it("구형 list와 최신 entries 에이전트 설정을 모두 집계한다", () => {
    expect(openClawAgentCount({ agents: { list: [{ id: "pm" }, { id: "qa" }] } })).toBe(2);
    expect(openClawAgentCount({ agents: { entries: { pm: {}, qa: {}, dev: {} } } })).toBe(3);
  });

  it("기존 프로젝트를 비파괴 복사하고 이미 있는 파일은 덮어쓰지 않는다", () => {
    const target = tempDir();
    const source = tempDir();
    process.env.VE_DATA_ROOT = target;
    const sourceProject = path.join(source, "workspace", "projects", "old-game");
    const targetProject = path.join(target, "workspace", "projects", "old-game");
    fs.mkdirSync(sourceProject, { recursive: true });
    fs.mkdirSync(targetProject, { recursive: true });
    fs.writeFileSync(path.join(sourceProject, "project.json"), JSON.stringify({ name: "옛 프로젝트" }));
    fs.writeFileSync(path.join(sourceProject, "GDD.md"), "원본");
    fs.writeFileSync(path.join(targetProject, "GDD.md"), "새 앱에서 수정한 내용");

    const receipt = importLegacyData(source);

    expect(receipt.projects).toBe(1);
    expect(fs.readFileSync(path.join(targetProject, "GDD.md"), "utf-8")).toBe("새 앱에서 수정한 내용");
    expect(JSON.parse(fs.readFileSync(path.join(targetProject, "project.json"), "utf-8")).name).toBe("옛 프로젝트");
  });

  it("사용자가 고른 쓰기 가능한 Codex 폴더를 영속 저장한다", () => {
    process.env.VE_DATA_ROOT = tempDir();
    const code = tempDir();
    expect(setCodexWorkdir(code)).toMatchObject({ dir: path.resolve(code), exists: true, writable: true, configured: true });
    expect(resolveCodexWorkdir().dir).toBe(path.resolve(code));
  });

  it("새 설치는 구독 AI를 기본값으로 쓰고 사용자가 OpenClaw로 전환할 수 있다", () => {
    process.env.VE_DATA_ROOT = tempDir();
    expect(resolveAiRuntime()).toBe("subscription");
    expect(setAiRuntime("openclaw")).toBe("openclaw");
    expect(resolveAiRuntime()).toBe("openclaw");
    expect(setAiRuntime("subscription")).toBe("subscription");
  });
});

describe("Unity WebGL 미리보기", () => {
  it("Unity 프로젝트의 표준 WebGL 빌드 폴더를 자동으로 찾는다", () => {
    const data = tempDir();
    const unity = tempDir();
    const build = path.join(unity, "Builds", "WebGL");
    process.env.VE_DATA_ROOT = data;
    fs.mkdirSync(path.join(data, "config"), { recursive: true });
    fs.mkdirSync(build, { recursive: true });
    fs.writeFileSync(path.join(build, "index.html"), "<title>Game</title>");
    fs.writeFileSync(path.join(data, "config", "unity.local.json"), JSON.stringify({ dir: unity }));

    expect(getUnityPreviewStatus()).toMatchObject({ ready: true, projectDir: unity, buildDir: build });
    expect(resolveUnityPreviewFile("index.html")).toBe(path.join(build, "index.html"));
  });

  it("사용자가 고른 빌드 폴더를 저장하고 폴더 밖 경로는 거부한다", () => {
    const data = tempDir();
    const build = tempDir();
    process.env.VE_DATA_ROOT = data;
    fs.writeFileSync(path.join(build, "index.html"), "<title>Game</title>");

    expect(setUnityWebglDir(build)).toMatchObject({ ready: true, configuredBuild: build });
    expect(() => resolveUnityPreviewFile("../secret.txt")).toThrow("허용되지 않은");
  });
});
