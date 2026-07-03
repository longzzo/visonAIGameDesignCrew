# 밸런스 데이터 테이블 문서

## character_stats.csv
- **용도**: 캐릭터 레벨별 기본 스탯
- **단위**: HP(체력), attack_speed(공격력), movement_speed(이동속도, 픽셀/초), attack_range(사거리, 픽셀)
- **계산 공식**: 
  - HP = 100 × 1.12^(Lv−1)
  - 공격력 = 15 × 1.09^(Lv−1)
  - 이동속도 = 80 + 0.9 × (Lv−1) + max(0, 1.5 × (Lv−30))
  - 검 사거리 = 120 + 1.8 × (Lv−1)

## growth_formulas.csv
- **용도**: 모든 스탯의 레벨 성장 공식 정의
- **단위**: 모든 수치는 character_stats.csv와 동일
- **계산 공식**: 
  - health: 100 * 1.12^(level-1)
  - attack_speed: 15 * 1.09^(level-1)
  - movement_speed: 80 + 0.9*(level-1) + max(0,1.5*(level-30))
  - attack_range: 120 + 1.8*(level-1)
  - cooldown: 고정 3초

## boss_difficulty_curve.csv
- **용도**: 레벨 구간별 난이도 설계
- **단위**: monster_count(마리), clear_time_seconds(초), enemy_defense(방어력), skill_timing_window(초, 스킬 사용 가능 창)
- **계산 공식**: 
  - enemy_defense = Lv × 1.2 + 10 (레벨 31~50)
  - skill_timing_window: 레벨이 올라갈수록 감소 → 플레이어 반응 속도 요구 증가

## decay_risk_scenario.csv
- **용도**: 밸런스 붕괴 시나리오 및 방지책
- **단위**: 없음 (정성적 분석)
- **계산 공식**: 없음
- **방지책 요약**: 레벨 50 이상에서 이동속도 제한으로 인한 플레이어 불만을 해소하기 위해, "눈물 나는 치즈 검"을 자동 해금하여 공격속도 보너스를 제공하고, 방어력 증가율을 완화함.
