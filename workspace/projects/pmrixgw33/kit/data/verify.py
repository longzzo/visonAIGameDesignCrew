# -*- coding: utf-8 -*-
"""kit/data 정합 검사 — 임포트 전에 돌리세요: python verify.py
통과 시 exit 0, 결함 발견 시 exit 1과 함께 어디가 틀렸는지 출력합니다.

왜 있나: "문서 속 숫자는 썩는다"(놓친 것 로그 패턴 3). 개수·참조·조합 검산이
사람 눈에 3회 연속 뚫렸다(51종·11종·16종). 이 스크립트가 번들에 동봉되므로
기획은 발송 전에, 개발은 임포트 전에 같은 검사를 돌릴 수 있습니다. (R1 품질 루프 신설 2026-07-19)
"""
import csv, io, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
os.chdir(os.path.dirname(os.path.abspath(__file__)))
ERRORS = []


def err(msg):
    ERRORS.append(msg)
    print(f"  ❌ {msg}")


def ok(msg):
    print(f"  ✅ {msg}")


def rd(p):
    return [r for r in csv.reader(open(p, encoding="utf-8")) if r]


# ── 1. items.csv — id 유일성 ──────────────────────────────
rows = rd("items.csv")
ids = [r[0] for r in rows[1:]]
items = set(ids)
if len(ids) != len(items):
    dup = sorted({x for x in ids if ids.count(x) > 1})
    err(f"items.csv id 중복: {dup}")
else:
    ok(f"items.csv {len(ids)}종 · id 중복 없음")

# ── 2. 참조 무결성 — 모든 CSV의 id 참조가 items에 존재 ──────
def check_mat(s, where):
    for tok in s.split(","):
        if not tok:
            continue
        iid = tok.split(":")[0]
        if iid not in items:
            err(f"{where}: 미등록 id `{iid}`")
        if ":" in tok and not tok.split(":")[1].isdigit():
            err(f"{where}: 수량 형식 오류 `{tok}`")


ct = rd("crafting-tree.csv")
h = {k: i for i, k in enumerate(ct[0])}
for c in ("id", "station_id", "materials", "output_count", "mvp_scope"):
    if c not in h:
        err(f"crafting-tree.csv 필수 열 없음: {c}")
if not ERRORS:
    for r in ct[1:]:
        if r[0] not in items:
            err(f"crafting-tree `{r[0]}`: 결과물이 items.csv에 없음")
        if r[h["station_id"]] != "none" and r[h["station_id"]] not in items:
            err(f"crafting-tree `{r[0]}`: 제작대 `{r[h['station_id']]}` 미등록")
        check_mat(r[h["materials"]], f"crafting-tree `{r[0]}`")
        if not r[h["output_count"]].isdigit() or int(r[h["output_count"]]) < 1:
            err(f"crafting-tree `{r[0]}`: output_count `{r[h['output_count']]}` 무효")
    ok(f"crafting-tree {len(ct)-1}행 · 결과물/재료/제작대/output_count")

for f, cols in [
    ("bosses.csv", ["summon_item_id", "station_id"]),
    ("drops.csv", ["sig_drop_id"]),
    ("modules.csv", ["item_id"]),
    ("player-combat.csv", ["item_id"]),
    ("mineral-tiers.csv", ["resource_id"]),
    ("accessories.csv", ["id"]),
    ("yokai-stats.csv", ["sig_drop_id"]),
]:
    rows = rd(f)
    hh = {k: i for i, k in enumerate(rows[0])}
    bad = 0
    for r in rows[1:]:
        for c in cols:
            if c in hh and r[hh[c]] and r[hh[c]] not in items:
                err(f"{f} {c}: `{r[hh[c]]}` 미등록")
                bad += 1
    if not bad:
        ok(f"{f} id 참조")

# bosses.summon_materials ↔ crafting-tree 레시피 일치 + drops extra_drops
bs = rd("bosses.csv")
hb = {k: i for i, k in enumerate(bs[0])}
recipes = {r[0]: r[h["materials"]] for r in ct[1:]}
for r in bs[1:]:
    sid = r[hb["summon_item_id"]]
    if sid in recipes and set(recipes[sid].split(",")) != set(r[hb["summon_materials"]].split(",")):
        err(f"bosses `{r[0]}`: summon_materials가 crafting-tree `{sid}` 레시피와 불일치")
ok("보스 소환 재료 ↔ crafting-tree 레시피 일치")
dr = rd("drops.csv")
hd = {k: i for i, k in enumerate(dr[0])}
for r in dr[1:]:
    check_mat(r[hd["extra_drops"]], f"drops `{r[0]}` extra_drops")

# ── 3. smelting — id 유일 + batch_cap 동일 계약 ─────────────
sm = rd("smelting.csv")
hs = {k: i for i, k in enumerate(sm[0])}
sids = [r[0] for r in sm[1:]]
if len(sids) != len(set(sids)):
    err("smelting.csv 레시피 id 중복")
caps = {}
for r in sm[1:]:
    caps.setdefault(r[hs["station_id"]], set()).add(r[hs["batch_cap"]])
for st, cs in caps.items():
    if len(cs) != 1:
        err(f"smelting batch_cap 계약 위반: {st} = {sorted(cs)} (같은 제작대는 동일해야 함)")
ok(f"smelting {len(sm)-1}행 · id 유일 · batch_cap 계약({', '.join(f'{k}={list(v)[0]}' for k,v in caps.items())})")

# ── 4. day-curve — 조합 총량 = count×mult · 요괴 id 등록 ─────
yk = {r[0] for r in rd("yokai-stats.csv")[1:]} | {r[0] for r in bs[1:]}
dc = rd("day-curve.csv")
hc = {k: i for i, k in enumerate(dc[0])}
for r in dc[1:]:
    d, cnt = int(r[0]), int(r[hc["night_yokai_count"]])
    ma, mult = int(r[hc["max_active"]]), float(r[hc["spawn_mult"]])
    tot = 0
    for tok in r[hc["spawn_composition"]].split(","):
        k, c = tok.split(":")
        if k not in yk:
            err(f"day-curve d{d}: 요괴 id `{k}` 미등록")
        tot += int(c)
    if tot != min(round(cnt * mult), ma):
        err(f"day-curve d{d}: 조합 총합 {tot} ≠ count {cnt} × mult {mult} (상한 {ma})")
ok(f"day-curve {len(dc)-1}행 · 조합 총량 검산")

# ── 4b. day-curve 공식·게이트·토큰 (R2 추가) ───────────────
APPEAR = {"club": 1, "bulgasari": 6, "yakwang": 11, "eoduksini": 16, "gangcheol": 30}
for r in dc[1:]:
    d, cnt = int(r[0]), int(r[hc["night_yokai_count"]])
    if d != 15 and cnt != min(8, 1 + (d - 1) // 4):
        err(f"day-curve d{d}: count {cnt} ≠ 공식 min(8,1+floor((d-1)/4)) (백중 d15만 예외)")
    for tok in r[hc["spawn_composition"]].split(","):
        k, c = tok.split(":")
        if int(c) == 0:
            err(f"day-curve d{d}: 0마리 토큰 `{tok}` — 빼고 쓸 것(파서 혼란)")
        if k in APPEAR and d < APPEAR[k]:
            err(f"day-curve d{d}: `{k}`는 {APPEAR[k]}일차부터")
ok("day-curve 공식·등장일 게이트·0토큰")

# ── 5. 밸런스 고정점 — GDD 확정값 (틀리면 원장이 무너진다) ──
HP = {"club": 450, "bulgasari": 750, "yakwang": 150, "eoduksini": 800, "gangcheol": 2000}
fixed = {10: ("club:2,bulgasari:1", 1650, "10일차 ΣHP(GDD 6-7)"),
         20: ("club:1,bulgasari:2,eoduksini:2", 3550, "20일차 Σ실효(GDD 6-7)"),
         15: ("club:3,bulgasari:2,yakwang:7", 3900, "백중 ΣHP(GDD 6-10)"),
         30: ("club:2,bulgasari:2,yakwang:1,eoduksini:2,gangcheol:1", 6150, "30일차 Σ실효(GDD 6-7)")}
for day, (comp, expect, label) in fixed.items():
    row = [r for r in dc[1:] if r[0] == str(day)][0]
    if row[hc["spawn_composition"]] != comp:
        err(f"d{day} 조합이 정본과 다름: {row[hc['spawn_composition']]} (정본: {comp})")
    tot = sum(HP[t.split(":")[0]] * int(t.split(":")[1]) for t in comp.split(","))
    if tot != expect:
        err(f"{label}: {tot} ≠ {expect}")
ok("밸런스 고정점 — 백중 3,900 · 30일차 6,150")

# ── 6. globals — 필수 키 존재 ────────────────────────────────
g = open("globals.csv", encoding="utf-8").read()
REQUIRED = ["start_at_night", "player_move_speed", "surface_y", "yokai_cap",
            "baekjung_spawn_cap", "invasion_boss_in_cap", "boss_night_spawn",
            "boss_field_yokai", "wallpaper_coverage", "wallpaper_coldsource_bonus",
            "wallpaper_remove_rule", "furniture_mvp_scope", "cave_max_height",
            "crafting_b_ui", "item_id_rule"]
missing = [k for k in REQUIRED if f"\n{k}," not in g and not g.startswith(f"{k},")]
if missing:
    err(f"globals.csv 필수 키 누락: {missing}")
else:
    ok(f"globals 필수 키 {len(REQUIRED)}종")

# ── 7. id-migration — 대상 존재 ─────────────────────────────
mig = rd("id-migration.csv")
hm = {k: i for i, k in enumerate(mig[0])}
smelt_ids = set(sids)
for r in mig[1:]:
    nw, dom, act = r[hm["new_id"]], r[hm["domain"]], r[hm["action"]]
    if act != "rename":
        continue
    pool = {"item": items, "yokai": yk, "boss": {b[0] for b in bs[1:]}, "smelting": smelt_ids}[dom]
    if nw not in pool:
        err(f"id-migration `{r[0]}` → `{nw}` ({dom}): 대상 미등록")
ok(f"id-migration {len(mig)-1}행 · rename 대상 전량 존재")

# ── 결과 ────────────────────────────────────────────────────
print()
if ERRORS:
    print(f"🔴 결함 {len(ERRORS)}건 — 위 항목을 고치기 전에 임포트하지 마세요.")
    sys.exit(1)
print("🟢 전 검사 통과 — 임포트해도 좋습니다.")
