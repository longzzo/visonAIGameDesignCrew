import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { marpCli } from "@marp-team/marp-cli";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vision-engine-deck-smoke-"));
const source = path.join(root, "deck.md");
const browser = [
  process.env.VE_MARP_BROWSER_PATH,
  process.platform === "win32" && process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
  process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
  process.platform === "win32" && process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : "",
  process.platform === "win32" && process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : "",
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "",
  process.platform === "darwin" ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" : "",
  process.platform === "linux" ? "/usr/bin/google-chrome" : "",
  process.platform === "linux" ? "/usr/bin/microsoft-edge" : "",
  process.platform === "linux" ? "/usr/bin/chromium" : "",
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
const markdown = `---
marp: true
paginate: true
---

# Vision Engine

상용 패키지 발표자료 렌더링 검증

---

## 두 번째 슬라이드

- HTML 기반 슬라이드
- PDF 및 PPTX 내보내기
`;

try {
  fs.writeFileSync(source, markdown, "utf-8");
  for (const [flag, extension, magic] of [
    ["--pdf", "pdf", "%PDF-"],
    ["--pptx", "pptx", "PK"],
  ]) {
    const output = path.join(root, `deck.${extension}`);
    const code = await marpCli([
      "--no-stdin",
      "--browser-timeout", "120",
      ...(browser ? ["--browser-path", browser] : []),
      flag,
      source,
      "-o", output,
    ], { baseUrl: root });
    assert.equal(code, 0, `${extension} 변환 종료 코드`);
    assert.ok(fs.existsSync(output), `${extension} 파일 생성`);
    assert.ok(fs.statSync(output).size > 1_000, `${extension} 파일 크기`);
    const header = fs.readFileSync(output).subarray(0, magic.length).toString("ascii");
    assert.equal(header, magic, `${extension} 파일 시그니처`);
  }
  console.log("✅ Marp PDF·PPTX smoke 통과");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
