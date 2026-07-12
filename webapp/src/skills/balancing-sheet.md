# 밸런싱 수치 시트 작성 스킬

밸런스 디자이너가 데이터 테이블(CSV/JSON)을 만들 때 따르는 규칙.
공개 자료(Game Developer·StraySpark·MY.GAMES 밸런스 파이프라인 글) 요지를 이 프로젝트 형편에 맞게 증류했다.

## 파일 구성 원칙

- **카테고리별 파일 분리** — 하나의 거대 표 금지. 예: `data/economy.csv`(경제 상수), `data/market-prices.csv`(품목 시세), `data/boss-stats.csv`(보스), `data/gacha.csv`(뽑기 확률).
- **전역 변수 테이블** — 여러 표가 공유하는 상수(예: 하루 길이, 기준 골드 수입)는 `data/globals.csv` 한 곳에만 둔다. 다른 표는 그 이름을 참조(비고 열)하고 값을 복붙하지 않는다.
- **id는 영문 snake_case** (`napa_cabbage`), 표시명은 별도 `name_ko` 열. 엔진/코드가 id로 조회한다.
- **단위·범위를 열 이름에** — `price_gold`, `drop_rate_pct`, `respawn_sec`처럼 단위가 이름에 보이게.

## 수치 원칙

- **확정 수치 최우선** — 기획서·결정사항에 이미 확정된 값(가격·확률·제한)은 그대로 옮긴다. 임의 변경 금지. 새로 정하는 값은 비고 열에 `가안` 표기.
- **수도꼭지 ≥ 배수구** — 재화 획득 합계(faucet)가 소비 합계(sink)의 **1.1~1.3배**가 되게 잡는다. 그보다 낮으면 벌 받는 느낌, 높으면 골드가 무의미해진다.
- **곡선은 공식으로** — 성장·비용 곡선은 행마다 손으로 찍지 말고 공식(예: `cost(n) = base × 1.15^n`)을 정하고 그 공식으로 행을 채운다. 공식은 README에 기록.
- **표끼리 모순 금지** — 보스 드랍률 표와 챕터 진행 표가 서로 안 맞으면 안 된다. 제출 전에 교차 확인.

## 산출 형식

- CSV는 헤더 행 필수, 최소 8행 실데이터, 값은 전부 확정 숫자(범위·물음표 금지).
- 마지막에 `data/README.md`: 각 표의 용도, 열 단위, 계산 공식, 근거(어느 기획서의 어느 확정 사항인지).

## 참고 자료

- Game Developer — My Approach To Economy Balancing Using Spreadsheets
- StraySpark — Game Economy Balancing With Spreadsheets (faucet/sink 1.1~1.3x)
- MY.GAMES — Avoid the cell and table swamp (계산 열·전역 변수 분리)
- Game Developer — Technical GDD Part 3: Spreadsheets (행=요소, 열=속성, 한 화면 폭)
