#!/usr/bin/env node
/**
 * 정본 MCP 서버 — **읽기 전용**.
 *
 * 왜 필요한가: 페르소나는 "도구로 파일을 직접 읽어 확인하라"고 시키는데 도구가 없으면
 * 모델은 "못 읽었다"고 말하는 대신 그럴듯한 파일명을 지어낸다(실측: recipes.csv,
 * RecipeData.json 등 존재하지 않는 파일 날조). 그렇다고 기획 에이전트에게
 * @modelcontextprotocol/server-filesystem 을 주면 write_file·edit_file·move_file 까지
 * 딸려 온다(도구 14개 중 4개가 쓰기). 그래서 읽기만 하는 서버를 따로 둔다.
 *
 * 사용:  node mcp-canon.mjs <프로젝트 폴더>
 *        (VE의 mcp.json에서는 args: ["{{REPO}}/webapp/server/mcp-canon.mjs", "{{PROJECT}}"])
 *
 * 노출 범위 — 프로젝트 폴더 안에서 "정본"에 해당하는 것만:
 *   GDD.md · decisions.json · approvals.json · project.json · kit/**
 * 제외 — 백업(*.bak*), 회의 로그, 산출물, 아트, 히스토리.
 *   백업을 함께 보여주면 에이전트가 낡은 판(v37/v55…)을 정본으로 인용한다.
 */
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ROOT = path.resolve(process.argv[2] || process.cwd());

/** 정본으로 노출할 최상위 항목 */
const TOP_ALLOW = new Set(["GDD.md", "decisions.json", "approvals.json", "project.json", "kit"]);
/**
 * 파일명 기준 제외 — 백업·폐지본·임시.
 *
 * `.bak`만 걸렀더니 `night-waves.csv.deleted-v63`(v63에서 **폐지된** 파도 시스템)이
 * 정본 목록에 그대로 떴다(실측 2026-08-12). 폐지본은 백업보다 더 위험하다 —
 * 파일이 있으니 에이전트는 그 시스템이 살아 있다고 믿는다.
 */
const DENY_NAME = /(\.(bak|deleted|old|orig|disabled|removed|tmp)\b)|(~$)|(^\.)|(^desktop\.ini$)/i;

const MAX_BYTES = 400_000; // 한 번에 돌려줄 최대 크기
const MAX_HITS = 200;

/** ROOT 밖으로 못 나가게 + 정본 화이트리스트 검사 */
function resolveCanon(rel) {
  const clean = String(rel ?? "").replace(/^[\\/]+/, "");
  const abs = path.resolve(ROOT, clean);
  const inside = abs === ROOT || abs.startsWith(ROOT + path.sep);
  if (!inside) throw new Error(`정본 폴더 밖입니다: ${rel}`);
  const relFromRoot = path.relative(ROOT, abs);
  const top = relFromRoot.split(path.sep)[0];
  if (!TOP_ALLOW.has(top)) throw new Error(`정본이 아닙니다: ${relFromRoot} (허용: ${[...TOP_ALLOW].join(", ")})`);
  if (relFromRoot.split(path.sep).some((seg) => DENY_NAME.test(seg))) throw new Error(`백업·임시 파일은 읽을 수 없습니다: ${relFromRoot}`);
  return { abs, rel: relFromRoot.split(path.sep).join("/") };
}

/** 정본 파일 전체 목록 (재귀) */
function walk() {
  const out = [];
  const visit = (abs, rel) => {
    let ents = [];
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (DENY_NAME.test(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(abs, e.name)).size;
        } catch {
          /* noop */
        }
        out.push({ path: r, bytes: size });
      }
    }
  };
  for (const top of TOP_ALLOW) {
    const abs = path.join(ROOT, top);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) visit(abs, top);
    else out.push({ path: top, bytes: fs.statSync(abs).size });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const TOOLS = [
  {
    name: "list",
    description:
      "이 프로젝트의 정본 파일 목록(경로·크기)을 돌려준다. 백업(.bak)과 회의 로그는 제외된 상태다. 어떤 정본이 있는지 모를 때 가장 먼저 호출할 것.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read",
    description:
      "정본 파일 하나를 읽는다. path는 list가 돌려준 경로를 그대로 쓸 것(예: kit/data/globals.csv, GDD.md). 큰 파일은 offset/limit(행 단위)으로 잘라 읽는다.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "list가 돌려준 상대 경로" },
        offset: { type: "number", description: "시작 행(1부터). 생략 시 처음부터" },
        limit: { type: "number", description: "읽을 행 수. 생략 시 끝까지(최대 400KB)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "grep",
    description:
      "정본 전체에서 문자열/정규식을 찾아 파일:행:내용으로 돌려준다. 특정 수치·id·규칙이 정본에 실제로 있는지 확인할 때 쓸 것. 결과가 0건이면 그 값은 정본에 없는 것이다 — 지어내지 말 것.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "찾을 문자열 또는 정규식" },
        regex: { type: "boolean", description: "true면 정규식으로 해석(기본 false)" },
        ignoreCase: { type: "boolean", description: "대소문자 무시(기본 true)" },
        glob: { type: "string", description: "경로 부분 문자열 필터(예: kit/data)" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
];

const server = new Server({ name: "ve-canon", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const text = (s) => ({ content: [{ type: "text", text: s }] });
  try {
    if (name === "list") {
      const files = walk();
      if (!files.length) return text(`정본 파일이 없습니다. (루트: ${ROOT})`);
      return text(
        `정본 ${files.length}개 — 루트 ${path.basename(ROOT)}\n` +
          files.map((f) => `${f.path}\t${f.bytes}B`).join("\n")
      );
    }

    if (name === "read") {
      const { abs, rel } = resolveCanon(args.path);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return text(`없는 파일입니다: ${rel}`);
      const raw = fs.readFileSync(abs, "utf-8");
      const lines = raw.split(/\r?\n/);
      const off = Math.max(1, Number(args.offset ?? 1));
      const lim = Number(args.limit ?? lines.length);
      const slice = lines.slice(off - 1, off - 1 + lim);
      let body = slice.join("\n");
      let note = "";
      if (Buffer.byteLength(body, "utf-8") > MAX_BYTES) {
        body = body.slice(0, MAX_BYTES);
        note = `\n…(${MAX_BYTES}바이트에서 잘림 — offset/limit으로 나눠 읽으세요)`;
      }
      return text(`# ${rel} (전체 ${lines.length}행, ${off}~${Math.min(lines.length, off + lim - 1)}행)\n${body}${note}`);
    }

    if (name === "grep") {
      const ic = args.ignoreCase !== false;
      let re;
      try {
        re = args.regex
          ? new RegExp(args.pattern, ic ? "i" : "")
          : new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ic ? "i" : "");
      } catch (e) {
        return text(`정규식 오류: ${e.message}`);
      }
      const hits = [];
      for (const f of walk()) {
        if (args.glob && !f.path.includes(args.glob)) continue;
        if (f.bytes > 3_000_000) continue;
        let raw = "";
        try {
          raw = fs.readFileSync(path.join(ROOT, f.path), "utf-8");
        } catch {
          continue;
        }
        raw.split(/\r?\n/).forEach((line, i) => {
          if (hits.length >= MAX_HITS) return;
          if (re.test(line)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 300)}`);
        });
        if (hits.length >= MAX_HITS) break;
      }
      if (!hits.length) return text(`0건 — "${args.pattern}"은(는) 정본에 없습니다. 새로 제안하는 것이라면 "신규"라고 명시하세요.`);
      return text(`${hits.length}건${hits.length >= MAX_HITS ? "(상한)" : ""}\n${hits.join("\n")}`);
    }

    return { content: [{ type: "text", text: `모르는 도구: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
