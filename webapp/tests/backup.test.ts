import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { backupStatus, createProjectBackup, restoreProjectBackup } from "../server/backup-store.mjs";

const temporary: string[] = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-backup-test-"));
  temporary.push(root);
  return root;
}

function addProject(root: string, id: string, name: string) {
  const directory = path.join(root, "workspace", "projects", id);
  fs.mkdirSync(path.join(directory, "deliverables"), { recursive: true });
  fs.writeFileSync(path.join(directory, "project.json"), JSON.stringify({ name, createdAt: 1 }));
  fs.writeFileSync(path.join(directory, "GDD.md"), `# ${name}\n`);
  fs.writeFileSync(path.join(directory, "deliverables", "sample.bin"), Buffer.from([0, 1, 2, 255]));
  return directory;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("프로젝트 백업과 비파괴 복원", () => {
  it("텍스트와 바이너리를 백업하고 기존 프로젝트는 복원본 사본으로 만든다", () => {
    const root = tempRoot();
    const original = addProject(root, "sample", "샘플 게임");
    const status = backupStatus(root);
    expect(status).toMatchObject({ projects: 1, files: 3 });

    const backup = createProjectBackup({ root, now: new Date("2026-09-10T00:00:00Z") });
    expect(backup.manifest).toMatchObject({ projectCount: 1, fileCount: 3 });
    const receipt = restoreProjectBackup(backup.buffer, { root, now: new Date("2026-09-11T00:00:00Z") });

    expect(receipt.imported).toHaveLength(1);
    expect(receipt.imported[0]).toMatchObject({ sourceId: "sample", copied: true });
    expect(fs.readFileSync(path.join(original, "GDD.md"), "utf-8")).toBe("# 샘플 게임\n");
    const restored = path.join(root, "workspace", "projects", receipt.imported[0].id);
    expect(fs.readFileSync(path.join(restored, "deliverables", "sample.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(JSON.parse(fs.readFileSync(path.join(restored, "project.json"), "utf-8"))).toMatchObject({
      name: "샘플 게임 (복원본)",
      sourceProjectId: "sample",
    });
  });

  it("해시가 변조된 파일은 쓰기 전에 거부한다", () => {
    const root = tempRoot();
    addProject(root, "sample", "샘플 게임");
    const backup = createProjectBackup({ root });
    const document = JSON.parse(zlib.gunzipSync(backup.buffer).toString("utf-8"));
    document.projects[0].files[0].sha256 = "0".repeat(64);
    const tampered = zlib.gzipSync(Buffer.from(JSON.stringify(document)));

    expect(() => restoreProjectBackup(tampered, { root })).toThrow("무결성 검증");
    expect(backupStatus(root).projects).toBe(1);
  });

  it("경로 탈출이 포함된 백업은 거부한다", () => {
    const root = tempRoot();
    addProject(root, "sample", "샘플 게임");
    const backup = createProjectBackup({ root });
    const document = JSON.parse(zlib.gunzipSync(backup.buffer).toString("utf-8"));
    document.projects[0].files[0].path = "../outside.txt";
    const hostile = zlib.gzipSync(Buffer.from(JSON.stringify(document)));

    expect(() => restoreProjectBackup(hostile, { root })).toThrow("안전하지 않은 파일 경로");
    expect(fs.existsSync(path.join(root, "workspace", "outside.txt"))).toBe(false);
  });
});
