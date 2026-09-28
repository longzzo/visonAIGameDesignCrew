import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { MAX_BACKUP_BYTES, backupFileName, createPreUpdateProjectBackup } = require("../../desktop/update-backup.cjs");
const temporaryDirectories: string[] = [];

function temporaryUserData(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-update-backup-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function serveBackup({ projects = 1, contentType = "application/vnd.vision-engine.backup", declaredBytes }: {
  projects?: number;
  contentType?: string;
  declaredBytes?: number;
} = {}) {
  const archive = gzipSync(Buffer.from(JSON.stringify({ version: 1, projects: [{ id: "demo" }] })));
  let exportRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/api/backup/status") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, projects }));
      return;
    }
    if (request.url === "/api/backup/export") {
      exportRequests += 1;
      response.setHeader("Content-Type", contentType);
      response.setHeader("Content-Length", String(declaredBytes ?? archive.length));
      response.end(archive);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("테스트 서버 포트를 확인하지 못했습니다.");
  return {
    archive,
    port: address.port,
    exportRequests: () => exportRequests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("업데이트 전 프로젝트 자동 백업", () => {
  it("검증된 GZIP 백업을 임시 파일에서 원자적으로 확정한다", async () => {
    const fixture = await serveBackup();
    try {
      const userDataDir = temporaryUserData();
      const result = await createPreUpdateProjectBackup({
        userDataDir,
        runtimePort: fixture.port,
        currentVersion: "4.2.6",
        targetVersion: "4.2.7",
        now: new Date("2026-09-29T01:02:03.004Z"),
      });
      expect(result.created).toBe(true);
      expect(result.name).toBe("VisionEngine-pre-update-v4.2.6-to-v4.2.7-20260929010203004.vebackup");
      expect(fs.readFileSync(result.file)).toEqual(fixture.archive);
      expect(result.sha256).toBe(crypto.createHash("sha256").update(fixture.archive).digest("hex"));
      expect(fs.readdirSync(path.dirname(result.file)).some((name) => name.endsWith(".partial"))).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("프로젝트가 없으면 다운로드 없이 안전하게 건너뛴다", async () => {
    const fixture = await serveBackup({ projects: 0 });
    try {
      const result = await createPreUpdateProjectBackup({
        userDataDir: temporaryUserData(), runtimePort: fixture.port, currentVersion: "4.2.6", targetVersion: "4.2.7",
      });
      expect(result).toMatchObject({ created: false, reason: "no-projects", projects: 0 });
      expect(fixture.exportRequests()).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  it("원격 서버 모드는 로컬 프로젝트 API에 접속하지 않는다", async () => {
    const result = await createPreUpdateProjectBackup({
      userDataDir: temporaryUserData(), runtimePort: 65535, currentVersion: "4.2.6", targetVersion: "4.2.7", remoteServerUrl: "https://studio.example.com",
    });
    expect(result).toEqual({ created: false, reason: "remote-client" });
  });

  it("잘못된 응답이나 크기 초과를 거부하고 부분 파일을 남기지 않는다", async () => {
    for (const options of [
      { contentType: "text/html" },
      { declaredBytes: MAX_BACKUP_BYTES + 1 },
    ]) {
      const fixture = await serveBackup(options);
      const userDataDir = temporaryUserData();
      try {
        await expect(createPreUpdateProjectBackup({
          userDataDir, runtimePort: fixture.port, currentVersion: "4.2.6", targetVersion: "4.2.7",
        })).rejects.toThrow(/형식|300MB/);
        const backupDirectory = path.join(userDataDir, "backups");
        expect(fs.existsSync(backupDirectory) ? fs.readdirSync(backupDirectory) : []).toEqual([]);
      } finally {
        await fixture.close();
      }
    }
  });

  it("파일명에 사용할 수 없는 버전 문자를 정리한다", () => {
    expect(backupFileName({ currentVersion: "4.2.6 beta/1", targetVersion: "4.2.7+sale", now: new Date("2026-09-29T00:00:00Z") }))
      .toBe("VisionEngine-pre-update-v4.2.6-beta-1-to-v4.2.7-sale-20260929000000000.vebackup");
  });

});
