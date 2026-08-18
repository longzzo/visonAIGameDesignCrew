import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendUsage, summarizeUsage } from "../server/usage-store.mjs";
import { createJob, latestRecoverableJob, updateJob } from "../server/job-store.mjs";
import { resolveProvider } from "../server/dev-provider.mjs";
import { importLegacyData, resolveCodexWorkdir, setCodexWorkdir } from "../server/readiness.mjs";

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.VE_DATA_ROOT;
});

describe("개발 모델 제공자 어댑터", () => {
  it("모델 접두사로 제공자와 모델 id를 분리한다", () => {
    const provider = resolveProvider("github/openai/gpt-5", {
      models: { providers: { github: { baseUrl: "https://models.example/v1/", apiKey: "test", models: [] } } },
    });
    expect(provider).toMatchObject({ id: "github", modelId: "openai/gpt-5", baseUrl: "https://models.example/v1" });
  });

  it("Ollama의 OpenAI 호환 v1 경로와 로컬 키를 자동 보완한다", () => {
    const provider = resolveProvider("ollama/qwen3:8b", {
      models: { providers: { ollama: { baseUrl: "http://127.0.0.1:11434", api: "ollama", models: [] } } },
    });
    expect(provider).toMatchObject({ baseUrl: "http://127.0.0.1:11434/v1", key: "ollama-local", modelId: "qwen3:8b" });
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
    appendUsage({ model: "ollama/qwen3:8b", input: 7, output: 11, calls: 1 }, file);
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
});
