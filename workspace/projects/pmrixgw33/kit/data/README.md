# 밸런스 데이터 — 100일의 냥빙고: 서리발톱 대작전

> **원본(single source of truth)**. 코드에 수치 하드코딩 금지 — 이 CSV를 Unity ScriptableObject로 임포트한다(개발 규칙 §4). 기획자는 코드 없이 여기만 고쳐 밸런싱한다.

## 핵심 원칙 (정본 1장·6장 정합)
- **진행 축은 레벨이 아니라 일차(Day)+더위 단계.** 레벨업 RPG 아님.
- **지하 진입 게이트는 발톱 티어뿐**(v7 — 고양이가 발톱으로 직접 캔다, 곡괭이 폐지) — 일차 시간 게이트 없음(GDD 4-4). day-curve의 pace_* 열은 권장 페이스이지 해금 조건이 아니다. 제련대 레시피는 광석만 사용(주괴 순환 잠금 방지 — GDD 4-7).
- **밀폐도**(seal)는 벽 타일 flood-fill로 계산되는 **공간 상태**(0~100%)지 성장 스탯이 아니다.
- **체온**(temp)은 낮 상승·밤 하강하는 **관리 게이지**(0 시원 ~ 100 열사병)지 성장 스탯이 아니다.

## 파일
- `globals.csv` — 전역 상수(낮밤 길이·체온 파라미터·승리 조건·타일 크기·팀).
- `day-curve.csv` — 일차(1~30)별 더위단계·낮 화염·밤 도깨비 수·벽타격·권장 밀폐도/광물 티어 페이스. **차트로 보면 난이도 곡선이 한눈에.**
- `yokai-stats.csv` — 한국 요괴 5종(방망이 도깨비·불가사리·야광귀·어둑시니·강철이 — 정본 4-1) HP·속도·벽DPS·접촉·눈물·시그니처 드랍 (GDD 6-7).
- `player-combat.csv` — 발톱 3티어(맨발톱·무쇠·얼음강철) + 무기 2종(도깨비 방망이·서리발톱 장갑) + 진화 무기 철선(E1) 공격력·DPS·넉백 + 밤 540초 검증 (GDD 6-7).
- `mineral-tiers.csv` — **자원 12종** × 발톱 3티어 채굴 매트릭스(초/타일·빈도·게이트) (GDD 6-4). v24.1 교정: 구 '11종'은 v7 점토 추가 전 수치. GDD 4-1 총 자원은 13종인데 [드랍] 요괴 눈물은 채굴 대상이 아니라 이 표에서 제외 — 13 − 1 = 12행이 정합.
- `equipment(armor)`은 crafting-tree.csv에 포함, `accessories.csv`(악세 6종 — 상자 전용)·`chests.csv`(보물 상자 20개 배치) 신설 (GDD 6-12).
- `crafting-tree.csv` — **조합식 54종**(v26 +벽지)(v24 교정 — 구 '51종'은 v20/v21 냉기원 2종(물단지·얼음 항아리) 신설 반영 누락. GDD 6-5도 동시 교정)(v12: +진화 4 — 철선·쇠 방울 금줄·무쇠 체·서리 등불)(v11: +유틸 2 — 합죽선·방울 금줄)(v8: +장비 9)(v7: 제작대 4단(+용광로)·발톱 2·단열 3·꾸미기 5, 곡괭이 폐지) + `smelting.csv` — 제련 3종(광석 2+석탄=주괴 1): 제작대 3·도구 3·설치물 3(등불·체·해태 석상)·무기 2·무쇠 차열벽·냉기 장치·모듈 5 (GDD 6-5).
- `day-curve-ext.csv` — **확장(31~50일) 전용** 곡선 + 용해(ice_melt_dps)·열기 스며듦(heat_seep_pct, 실효 하강=0.15×(1+짚−스며듦)) — MVP day-curve.csv 무수정 원칙(확장 설계서 §3④).
- `crafting-ext.csv` — **확장 전용** 진화 2단계 2종(설풍선·서리 금줄 — 얼음 모루·원본 소모) — MVP crafting-tree.csv 무수정 원칙(확장 설계서 §3⑤).
- `seal-whitelist.csv` — **밀폐 인정 화이트리스트**(요소별 seals 0/1) — SealSystem이 SO로 읽어 판정, 코드에 타일 종류 하드코딩 금지. 표에 없는 신규 설치물 기본값은 0(안전 기본값). GDD 4-7 표가 정본, 이 CSV는 그 기계 판독본(v15).
- `modules.csv` — 석빙고 핵심 모듈 5종 건설 비용 (2026-07-14 오너 승인 확정).
- `drops.csv` — 요괴별 눈물·시그니처 드랍·확률·용도 (GDD 6-7·6-8).
- `bosses.csv` — 소환 보스 4종(도깨비 대장·어미 불가사리·이무기·강철이) 소환템·HP·패턴·확정 드랍·교전 검증 (GDD 6-9).
- `items.csv` — **(v24 신설 · v26 갱신) 아이템 마스터 86종 — 전 id의 유일 정본**. `id,name_ko,category,max_stack,mvp_scope,note`. category 8종: resource 12 · material 13 · tool 3 · weapon 4 · equipment 15 · station 4 · placeable 31(v26 +벽지) · summon 4. max_stack = 장착물 1 / 나머지 99 / `bare_claw`만 0(신체).

## 데이터 계약 (v24 — Unity 임포트 전 필독)
- **파일 = CSV 17종 + 이 README = 18파일** (v24 `items.csv` + v24.1 `id-migration.csv` 신설). v23의 "16종"은 README 포함 표기였다 — v24부터 **CSV 16종 / 문서 1** 로 센다.
- **`items.csv`가 전 아이템의 유일한 id 정본(85종)**. 모든 CSV·코드·세이브는 이 id를 참조하고 **한글 이름으로 매칭하지 않는다**. 정본 절 = GDD 6-4b.
- **id 명명**: 전부 snake_case. 일반 명사 = 의미 영어(`iron_ore`·`stone`·`lantern`) / 한국 고유 문화어 = 로마자 음차(`hapjukseon`·`haetae_statue`·`yeouiju`·`eoduksini`).
- **id 변경 금지** — 세이브·에셋이 id로 묶인다. 개명 시 새 id 추가 + 구 id 유지(마이그레이션 표 동반).
- **재료 표기 = `item_id:count` 콤마 구분** (`stone:20,clay:12`). 구 한글 표기(`돌x20+점토x12`)는 v24에서 폐지.
- **`id-migration.csv`(v24.1 신설) = 레거시 id → v24 id 공식 마이그레이션 표.** 세이브·SO 로드 시 이 표로 1회 변환한다. `(legacy_id, domain)` 쌍이 키 — **`gangcheori`는 도메인에 따라 갈린다**: 개체(스폰·킬 카운트·도감·드랍 이력) = `gangcheol` / 보스전(격퇴 플래그·재소환 이력) = `gangcheol_boss`. 강철이 격퇴 플래그(가뭄 부적 해금)는 30일차 내습 격퇴를 포함해 `gangcheol_boss` 도메인에 기록한다. `action=remove_refund`(여우비 부적)는 인벤 보유분을 note의 환불식대로 변환 후 폐기.
- **드랍 기계 정본 = `drops.csv` 단일.** `bosses.csv`의 `drops_ko`는 기획자 확인용 표시 필드 — **임포터는 읽지 마라**(중복 지급 위험). 보스 환급분(조각2·비늘4·역린1)은 drops.csv `extra_drops`(item_id:count)로 구조화됨. 눈물 수량도 drops.csv `tears`가 정본.
- **제련 레시피 id = smelting.csv `id` 열**(smelt_iron·smelt_copper·smelt_icesteel — 진행 중 제련 세이브의 recipeId). output_id·행 순서로 식별 금지. **계약: 같은 station_id에 속한 행들의 batch_cap은 반드시 동일**(화로 6·용광로 4 — 검증 스크립트가 강제).
- **`crafting-ext.csv`·`day-curve-ext.csv`는 확장(31일~) 전용 — MVP 임포트 대상에서 제외한다**(데이터 계약 예외). 단 v24.1부터 crafting-ext도 id·`item_id:count` 형식이므로 확장 승격 시 출력 2종(seolpungseon·frost_bell_rope)을 items.csv에 등재만 하면 된다.
- **accessories.csv는 수치 컬럼이 정본**(move_speed_bonus 등 7열) — `effect_ko`는 표시용. 스택 상한(체온 합연산 −35%·크리 합산 25%)은 GDD 6-12 검증 절이 정본.
- **`output_count`(v26 신설) = 1회 제작 산출 개수.** `crafting-tree.csv`의 `materials` 바로 뒤에 있다. **기존 53행은 전부 `1`**, 벽지만 **`16`**이다 — 1회 제작에 여러 개가 나오는 첫 사례이므로 **제작 로직이 이 값을 반드시 읽어야 한다**(안 읽으면 벽지가 1장씩만 나온다).
- **벽지(`wallpaper`) 규칙 (v26 신설)** — 정본 절 = GDD 8-3:
  - `wallpaper_coverage=100` — 밀폐 구역의 빈 칸을 **100% 덮어야 발동**("전부 아니면 0", 부분 효과 없음). **지하 자연 배경벽(`t_bg_*`)이 이미 있는 칸은 덮인 것으로 계수**한다.
  - `wallpaper_coldsource_bonus=25` — 발동 시 그 구역 **냉기원 지속시간 +25%**(물단지 180→225초 · 얼음 항아리 얼음 1개당 300→375초). ⚠️ **얼음 저장고·빙정 냉각로는 적용 대상이 아니다** — 연료를 먹지 않는 영구 설치물이라 duration 파라미터 자체가 없고 `cold_cap_*` 상한만 존재한다.
  - `wallpaper_remove_rule=restore_original` — 제거 시 **원래 있던 것으로 복원**(지하 = 자연 배경벽 / 지상 = 빈 칸).
  - **온도 산식(4-7)·냉기원 상한(`cold_cap_*` 25/50/100)은 불변.** 벽지는 "얼마나 시원한가"가 아니라 "얼마나 오래 가는가"만 바꾼다.
  - **밀폐 판정 불참**(`seal-whitelist.csv`의 `배경벽(벽지)=0`) — 벽지만 발라서 밀폐를 만들 수는 없다.
  - 렌더: 배경 전용 Tilemap 1장, **SortingLayer를 전경과 분리**할 것(안 나누면 지상 건물 내부가 가려진다).
- **`-1` = 불가/해당 없음** (빈칸 = 값 미정과 구분). 예: mineral-tiers `claw_t1_sec=-1` = 그 발톱으론 못 캔다.
- **⚠️ id 함정**: `ice_core`(얼음 저장고 — 모듈)와 `cold_wave_core`(한파 코어 — 냉각 설비)는 **다른 물건**. modules.csv 기존 id 5종은 개발 참조 보호를 위해 승계했다.

## 열 의미 규정 (이중 적용 금지)
- **요괴 id 표준**: 어둑시니 = `eoduksini` (yokai-stats·day-curve 공통. `eoduk` 축약은 폐지)
- **day-curve.spawn_composition** = 그 밤의 **최종 스폰 조합**(배율 적용 후). 총합 = night_yokai_count × spawn_mult (max_active 상한).
  - d15 백중 = `club:3,bulgasari:2,yakwang:7` — GDD 6-10 고정 조합(ΣHP 3,900).
  - **d30 = `club:2,bulgasari:2,yakwang:1,eoduksini:2,gangcheol:1` — 강철이가 상한 8에 포함된다**(v24 교정). 근거 = GDD 6-7 밤 540초 검증 "30일차 8마리(방망이2+불가사리2+야광귀1+어둑시니2+강철이1) Σ실효 6,150 ÷ 30 = 205초, 여유 62.0%". 실효 HP를 더하면 정확히 6,150(어둑시니는 등불 실효 800).
- **내습 보스 ≠ 소환 보스** (v24 — 혼동 주의):
  - **내습**(30일차 강철이 고정) = `invasion_boss_in_cap=1` — **상한 8에 포함**, 일반 요괴 7과 **공존**한다.
  - **소환**(씨름 샅바·무쇠 미끼·얼음 제단·가뭄 부적) = `boss_night_spawn=discard` — 그날 밤 **일반 스폰 정지·잔여 폐기**.
- **day-curve.drop_mult** = 예약 훅(전 행 1.0 고정). **백중 드랍 배율은 globals `baekjung_tears_mult`(1.5)·`baekjung_sig_mult`(2)가 유일 정본** — 중복 적용 금지.
- **mvp_scope** = A(MVP 구현) / B(CSV·FSM 파라미터만, **제작 UI 미노출** — globals `crafting_b_ui=hidden`). 판정 규칙: 재료 사슬이 B급 보스(어미 불가사리·이무기)의 소환/드랍에 닿으면 자동 B. 가뭄 부적·한파 코어는 강철이(A) 사슬이라 A. 오너 확정 2026-07-16: MVP 보스 = 도깨비 대장·강철이 2종.
- **조건부 수치는 컬럼으로 분리**(v24 — 자유 텍스트 금지):
  - yokai-stats: `wall_dps_default`(돌·흙 차열벽·철 타일) / `wall_dps_ice`(얼음 타일) / `wall_dps_iron_wall`(무쇠 차열벽) — 불가사리 16/32/**0**(면역).
  - yokai-stats: `dmg_taken_mult`+`dmg_taken_condition` — 어둑시니 2.0/`lantern_radius`(등불 반경 내 피해 2배 = 실효 800). `contact_dmg`(14) vs `contact_dmg_no_lantern`(21).
  - yokai-stats: `steal_slots`·`steal_max_items` — 야광귀 1슬롯·최대 10개.
  - mineral-tiers: `min_claw_tier`+`gate_type`(none/soft/hard) — '불가' 문자열 폐지.

## 공식 (GDD 6-3)
- 더위 단계 = ceil(Day / 10)
- 밤 도깨비 수 = min(8, 1 + floor((Day-1)/4)) — 30일차 8마리 상한. 최종 도깨비는 30일차 밤 고정 1(상한에 포함)
- 낮 화염 데미지 = 1.5 x 더위단계 (지상 노출 시에만, 그늘/지하/석빙고=0)
- 체온: 낮 지상 +0.10/초 x 더위단계, 밤/안전지대 -0.15/초, 80 초과 열사병 (globals.csv 정합)
- 강제 건설 유도: 밀폐도가 권장 페이스보다 20%p 뒤처지면 낮 화염 +50%
- 붕괴 방지(6-6): 밀폐도 40% 미만 시 요괴 벽DPS +30% + 도구 강화 불가
- 재미 확장 룰(v6·6-10): 냥잠=낮 가속x4+체온 하강x3(밤은 회복만)·습격 자동 기상 / 백중날=15일차 밤 스폰 상한 12·눈물x1.5·시그니처x2(보스 소환 시 즉시 종료) / 까치=줍기 QoL·전투 개입 0.
- 보스전 룰(6-9): 소환=밤 전용, 보스전 중 일반 스폰 정지, 새벽 미격퇴 시 도주(소환템 소모). 터렛 연료=등불 로직 재사용. 한파 코어=더위단계 -1(하한 1).
- 요괴 카운터 룰(4-7): 등불=어둑시니 피해 2배(반경 6타일·석탄 연료) / 체=야광귀 12초 정지(반경 4타일·쿨 30초) / 해태 석상=화염 태그(태양·불가사리 숨결·강철이 브레스) 피해 -50%(반경 8타일)
- 승리: 밀폐도 100% + 모듈 5종 (오너 승인 확정. MVP는 30일차 데모 엔딩 — 보스 강철이, 백일폭염은 100일차)
