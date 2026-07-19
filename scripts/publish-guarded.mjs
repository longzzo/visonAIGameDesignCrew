#!/usr/bin/env node
/**
 * 노션 발행 — 가드 래퍼 (HANDOFF 함정 44 대응, 2026-07-19 신설)
 *
 * 왜 있나: notion-map.json의 키가 소실되면 발행기가 "살아있는 페이지를 못 찾고 새로 만든 뒤
 * 구 페이지를 휴지통으로 보낸다". 그러면 공유한 링크가 전부 죽는다. 2026-07-16(타임아웃 kill)과
 * 2026-07-19(원인 불명)에 두 번 발생했고, 두 번째는 트리거를 특정하지 못했다.
 * 원인을 모르는 사고는 "조심하기"로 못 막으므로 매 발행을 기계적으로 방어한다.
 *
 * 무엇을 하나:
 *   ① 발행 전 notion-map.json을 타임스탬프 백업
 *   ② 발행 전 "이번에 새로 생겨야 할 문서 수"를 맵과 대조해 미리 계산
 *   ③ 발행 후 실제 created와 비교 — 초과하면 🚨 경고 + 복구 명령 출력
 *   ④ 맵 키 수가 급감하면 발행 자체를 중단(--force로만 강행)
 *
 * 사용: node scripts/publish-guarded.mjs [projectId]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = process.argv[2] ?? "pmrixgw33";
const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");
const MAP_PATH = path.join(ROOT, "config", "notion-map.json");
const PROJ_DIR = path.join(ROOT, "workspace", "projects", PROJECT_ID);
const PUBLISH_CAP = 40; // notion-publish.mjs의 reports.slice(0, 40)과 일치해야 한다

const readMap = () => {
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, "utf-8"));
  } catch {
    return {};
  }
};

// ── ① 백업 ──────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17); // 밀리초까지 — 연속 실행 시 덮어쓰기 방지
const backupDir = path.join(ROOT, "config", "notion-map-backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `notion-map.${stamp}.json`);
if (fs.existsSync(MAP_PATH)) {
  fs.copyFileSync(MAP_PATH, backupPath);
  console.log(`🛟 맵 백업 → ${path.relative(ROOT, backupPath)}`);
}
// 백업 30개만 유지
const olds = fs.readdirSync(backupDir).filter((f) => f.startsWith("notion-map.")).sort();
for (const f of olds.slice(0, Math.max(0, olds.length - 30))) fs.rmSync(path.join(backupDir, f));

// ── ② 발행 대상 수집 + 예상 신규 수 계산 ─────────────────
const gddMd = fs.readFileSync(path.join(PROJ_DIR, "GDD.md"), "utf-8");
const repDir = path.join(PROJ_DIR, "reports");
const reports = fs
  .readdirSync(repDir)
  .filter((f) => /^\d+\.json$/.test(f))
  .sort()
  .reverse()
  .map((f) => JSON.parse(fs.readFileSync(path.join(repDir, f), "utf-8")))
  .map((r) => ({ ts: Number(r.ts) || 0, title: String(r.title ?? "보고서"), markdown: String(r.markdown ?? ""), kind: r.kind }));

const mapBefore = readMap();
const docsBefore = mapBefore?.[PROJECT_ID]?.docs ?? {};
const keyCountBefore = Object.keys(docsBefore).length;

// ⚠️ 기준은 "현재 맵"이 아니라 "직전 백업"이다.
// 현재 맵이 이미 훼손된 상태라면, 그 맵을 기준으로 계산한 '예상 신규'는 사고를 정당화해버린다
// (2026-07-19 실측: 키 20개를 지운 맵으로 발행하니 "예상 20 = 실제 20"이라 ✅ 통과했고,
//  실제로는 살아있는 페이지 20개가 재생성됐다 — 가드가 사고를 통과시킨 것).
// 기준 = 백업들 중 **키가 가장 많은 것**. "직전 백업"을 쓰면 그 백업 자체가 이미 훼손된 경우
// 기준이 함께 무너진다(2026-07-19 실측: 파괴 테스트로 생긴 31개짜리 백업이 기준이 돼 차단이 뚫렸다).
// 맵 키는 문서가 늘면 증가할 뿐 정상적으로는 줄지 않으므로, 최대치가 가장 안전한 하한선이다.
const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith("notion-map.")).sort();
let priorBackup = null;
let docsPrior = docsBefore;
let keyCountPrior = Object.keys(docsBefore).length;
for (const f of backups) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(backupDir, f), "utf-8"))?.[PROJECT_ID]?.docs ?? {};
    if (Object.keys(d).length > keyCountPrior) {
      docsPrior = d;
      keyCountPrior = Object.keys(d).length;
      priorBackup = f;
    }
  } catch {
    /* 깨진 백업은 건너뛴다 */
  }
}

// 발행기와 같은 분류 규칙 (notion-publish.mjs kindOf)
const kindOf = (r) => {
  if (r.kind === "spec" || r.kind === "minutes" || r.kind === "report") return r.kind;
  const t = String(r.title ?? "");
  if (t.startsWith("회의록")) return "minutes";
  if (/명세서|규칙|스펙|사양/.test(t)) return "spec";
  return "report";
};
const inScope = reports.slice(0, PUBLISH_CAP);
const expectedKeys = inScope.map((r) => `${kindOf(r) === "spec" ? "spec" : "rep"}:${r.ts}`);
// 직전 백업 기준 — 현재 맵이 훼손돼도 진짜 신규 수는 변하지 않는다
const expectedNew = expectedKeys.filter((k) => !docsPrior[k]).length;
const droppedByCap = reports.length - inScope.length;

console.log(`📊 맵 키 ${keyCountBefore}개(직전 ${keyCountPrior}) · 보고서 ${reports.length}개(발행 대상 ${inScope.length}) · 예상 신규 ${expectedNew}건`);
if (droppedByCap > 0) {
  console.log(`ℹ️  캡(${PUBLISH_CAP}) 밖으로 밀려난 오래된 보고서 ${droppedByCap}건 — 이들은 이번 발행 대상이 아니다`);
}

// ── ④ 맵 손상 사전 차단 — 키가 하나라도 줄었으면 멈춘다 ──
// (임계 비율을 두지 않는다. 2026-07-19에 0.6배 임계를 뒀다가 51→31이 아슬아슬하게 통과해 사고가 났다)
const lostKeys = Object.keys(docsPrior).filter((k) => !docsBefore[k]);
if (lostKeys.length > 0 && !FORCE) {
  console.error(`\n🚨 발행 중단 — 맵에서 키 ${lostKeys.length}개가 사라졌다 (직전 ${keyCountPrior} → 현재 ${keyCountBefore}).`);
  console.error(`   사라진 키 예시: ${lostKeys.slice(0, 5).join(", ")}${lostKeys.length > 5 ? " …" : ""}`);
  console.error(`   이 상태로 발행하면 살아있는 페이지가 재생성되고 공유한 링크가 전부 죽는다.`);
  console.error(`   ⓐ 복구: copy "${path.join(backupDir, priorBackup ?? "")}" "${MAP_PATH}"`);
  console.error(`   ⓑ 정말 의도한 것이라면 --force (되돌릴 수 없다)`);
  process.exit(2);
}
if (DRY_RUN) {
  console.log(`\n🧪 --dry-run — 발행하지 않고 종료. 위 예상치가 실제 발행 시 기대값이다.`);
  process.exit(0);
}

// ── ③ 발행 ──────────────────────────────────────────────
const kvCaption = {
  night: "밤 — 요괴 습격",
  day: "낮 — 백일폭염",
  bossfight: "보스전 — 백중날의 강철이 vs 신기전 화차",
  nap: "냥잠 — 까치 벗과 한낮의 휴식",
  treasure: "보물 상자 — 설한풍 한벌옷 차림의 심층 파밍 (v8 장비·악세)",
  summon: "아이콘 예시 — 보스 소환템 4종(씨름 샅바·무쇠 미끼·얼음 제단 봉헌·가뭄 부적)",
  armor: "아이콘 예시 — 장비 3부위×3티어(짚·무쇠·얼음강철)",
  accessories: "아이콘 예시 — 악세사리 6종(노리개·댕기·구슬·얼음 심장·복주머니·감투)",
};
const artDir = path.join(PROJ_DIR, "art");
const keyVisuals = fs.existsSync(artDir)
  ? fs
      .readdirSync(artDir)
      .filter((f) => /^(keyvisual|icons)-.+\.png$/i.test(f))
      .sort((a, b) => Number(/^icons-/i.test(a)) - Number(/^icons-/i.test(b)) || a.localeCompare(b))
      .map((f) => ({ path: path.join(artDir, f), caption: kvCaption[f.replace(/^(keyvisual|icons)-|\.png$/gi, "")] ?? f }))
  : [];

const { publishProject } = await import(pathToFileURL(path.join(ROOT, "webapp", "server", "notion-publish.mjs")).href);

const projectName = (() => {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(PROJ_DIR, "project.json"), "utf-8"));
    return pj.name ?? PROJECT_ID;
  } catch {
    return PROJECT_ID;
  }
})();

console.log(`🚀 발행 시작 — ${projectName} (비주얼 ${keyVisuals.length})`);
const res = await publishProject({ projectId: PROJECT_ID, projectName, gddMd, reports, keyVisuals });

// ── ③ 사후 검증 ─────────────────────────────────────────
const created = Number(res?.created ?? 0);
const keyCountAfter = Object.keys(readMap()?.[PROJECT_ID]?.docs ?? {}).length;
console.log(`\n📋 결과 — 재사용 ${res?.reused ?? "?"} · 갱신 ${res?.updated ?? "?"} · 신규 ${created} (맵 키 ${keyCountBefore} → ${keyCountAfter})`);

if (created > expectedNew) {
  console.error(`\n🚨 이상 감지 — 신규가 예상(${expectedNew})보다 ${created - expectedNew}건 많다.`);
  console.error(`   살아있던 페이지가 재생성됐을 가능성이 높다 = 이미 공유한 링크가 죽었다는 뜻이다.`);
  console.error(`   ⓐ 팀에 공유한 링크를 다시 확인하고 새 주소로 재전달할 것`);
  console.error(`   ⓑ 직전 맵: ${path.relative(ROOT, backupPath)}`);
  console.error(`   ⓒ 원인 조사 전까지 추가 발행을 하지 말 것 (사고가 누적된다)`);
  process.exitCode = 3;
} else {
  console.log(`✅ 정상 — 신규 ${created}건이 예상과 일치. 기존 링크 유지됨.`);
}
console.log(JSON.stringify(res));
