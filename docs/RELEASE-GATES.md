# Vision Engine 상용 출시 게이트

## 반드시 통과해야 하는 항목

- [x] 설치형 Windows 앱과 비파괴 사용자 데이터 이전
- [x] Electron renderer sandbox·context isolation·권한 거부·탐색 제한
- [x] 로컬 API Host/Origin 검증과 보안 응답 헤더
- [x] 웹앱·Electron 셸·설치 런타임 프로덕션 npm 취약점 moderate/high/critical 0건
- [x] 진단 로그 회전 및 비밀값을 제외한 지원 보고서
- [x] 전체 프로젝트 로컬 백업과 기존 데이터 비파괴 복원·무결성 검증
- [x] 제공 종료 모델 자동 차단·로컬 모델 이전 및 설치본 OpenClaw AI 호출
- [x] EULA·개인정보 안내·보안 신고 정책 초안
- [x] Electron 44 + 전체 Fuse 명시(새 Fuse 추가 시 빌드 실패)
- [x] ASAR 무결성·RunAsNode·Node 옵션/디버거·file:// 추가 권한 제한
- [x] 앱 내부 자동 업데이트 확인·다운로드·재시작 설치 흐름
- [x] 로컬 격리 포트에서 압축 해제본 기동·내장 런타임·두 번째 실행 E2E
- [x] 신규 공급자 키 보호 저장소 등록 및 기존 평문 키의 명시적 SecretRef 이전 흐름
- [ ] 실제 지원 이메일 확정
- [ ] Windows 코드 서명 인증서 연결 및 서명 검증
- [ ] GitHub Release에 설치 EXE·blockmap·`latest.yml` 업로드 후 업데이트 왕복 검증
- [ ] Gateway 릴레이 SecretRef 지원 및 OpenClaw 평문 자격증명 감사 0건
- [ ] 결제 상품·환불 정책·세금 처리·고객 지원 SLA 확정
- [ ] 클린 Windows VM 설치/업데이트/제거 E2E 통과

`node scripts/release-check.mjs --strict`가 자동 검증 가능한 출시 차단 항목을 검사합니다. 빈 제품 메타데이터나 서명 자격증명이 있으면 정식 배포를 실패시킵니다.

GitHub Actions의 `Windows release` 수동 실행은 새 Windows runner에서 설치·실행·보안 헤더·단일 인스턴스·제거를 자동 검증합니다. `vX.Y.Z` 태그 실행은 여기에 유효한 Authenticode 서명과 GitHub Release 게시까지 추가합니다. 설정 방법은 [상용 릴리스 운영서](COMMERCIAL-RELEASE.md)를 따릅니다.

## 4.2.3 로컬 검증 기록 (2026-09-28)

- Ollama `0.34.4`, OpenClaw `2026.9.6` 업데이트와 OpenClaw 상태 DB·에이전트 DB·검색 플러그인 마이그레이션 완료
- 손상되지 않은 DB를 막던 0바이트 잔여 Gateway lock만 복구 폴더로 격리하고 `openclaw doctor --fix --non-interactive` 통과
- 독립 로딩 창, 숨겨진 메인 창, Studio 우선 실행, OpenClaw 앱 관리 직행·백그라운드 자동 복구·잔여 진단 프로세스 정리·재시도 상한 회귀 검사 추가
- 전체 37개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과
- 웹앱·데스크톱의 프로덕션 및 전체 빌드 npm 보안 감사 4종 모두 취약점 0건
- 기존 `🖥️ 비전엔진 데스크톱 앱.lnk` 실행에서 Studio 5199를 먼저 준비하고 OpenClaw 18789 자동 복구 성공, 기존 프로젝트 5개 보존 확인
- Ollama 사용자 컨텍스트 `32768` 적용 후 설치본 `/api/agent` → OpenClaw → `ollama/qwen3.5:4b` 실제 요청 `OK` 응답(24.049초)
- NSIS 패키지 `305,166,124`바이트, blockmap·`latest.yml` 일치, 패키지 비밀정보 검사 0건
- 설치본 SHA-256: `d6f0e49acececf5fdef5e27f18b351acd24f4985fa7dc2758f91edc7bd0a86b6`
- 설치 파일과 앱 본체는 아직 상용 코드서명 전이므로 고객 배포 금지

## 4.2.0 로컬 검증 기록 (2026-09-11)

- GitHub Models·NVIDIA 모델 경로 2건을 가짜 환경값과 격리 OpenClaw 상태에서 설정 변경 없는 공식 plan dry-run으로 통과하고, 계획 파일 비밀값 미포함을 검사
- 설치된 Brave 플러그인의 `plugins.entries.brave.config.webSearch.apiKey` SecretRef 경로를 가짜 환경값과 무변경 dry-run으로 통과
- 신규 키 등록 API는 평문 설정 기록을 제거하고, 기존 키 이전은 Electron의 명시적 확인 UI에서만 실행
- OpenClaw 공식 적용 실패 시 기존 설정을 유지하며, Gateway 토큰은 이벤트 릴레이 호환 때문에 자동 이전에서 제외
- 전체 34개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과
- NSIS 패키지·설치본 검증과 최종 SHA-256은 아래 배포 전 검증에서 추가 기록

## 4.1.4 로컬 검증 기록 (2026-09-11)

- 제품 버전 `4.1.4`, 실제 사용자 위치 설치 및 기존 프로젝트 5개·에이전트 31명 보존
- 전체 프로젝트 `.vebackup` 생성 → 동일 데이터 폴더 복원 → 기존 프로젝트를 덮어쓰지 않고 복원본 생성 확인
- 백업 파일별 SHA-256, Base64, 파일 크기와 안전한 상대 경로 검증; 변조·경로 탈출 단위 테스트 통과
- `4.1.3` NSIS 임시 경로 설치 → 격리 userData/포트 실행 → 백업 왕복 → 런타임 강제 종료 자동복구 → 무인 제거 전체 E2E 통과(684.94초)
- `4.1.4`는 UTF-8 스트림 디코딩만 추가 수정한 뒤 전체 29개 테스트·타입 검사·프로덕션 빌드·런타임 smoke·패키지 검사를 재통과
- 실제 설치본에서 HTML·PDF·PPTX 파일 시그니처, 바로가기 실행, OpenClaw `2026.9.3`, Gateway, Codex 로그인 확인
- 퇴역 NVIDIA 모델을 31명 전원에서 제거하고 `ollama/qwen3.5:4b`로 이전; 선택형 `nvidia/nemotron-3-super-120b-a12b`는 공급자 직결 0.98초 및 Gateway 경유 설치본 호출·한글 무결성 통과
- 설치본 SHA-256: `d0379d3d0d3e940e9e6ddd17b5849ea807a698b9e1526ed6f1cb428b03120e2c`
- 패키지 비밀정보 검사 0건, 설치 파일과 앱 본체는 아직 상용 코드서명 전이므로 고객 배포 금지

## 4.0.0 로컬 검증 기록 (2026-09-10)

- Electron `44.3.0`, 제품/파일 버전 `4.0.0`
- 테스트 포트 `5299`, 별도 userData, OpenClaw 설정·데이터 이전 비활성 조건에서 내장 서버 연결 성공
- 두 번째 실행 프로세스 즉시 종료, 기존 프로세스 수 유지
- NSIS 임시 경로 설치 → 격리 userData/포트 실행 → 무인 제거 E2E 통과
- 실제 설치본에서 HTML·PDF·PPTX 발표자료 렌더 및 파일 시그니처 검증 통과
- 설치본 SHA-256: `9d140b96a6f142157355f5fc83b269ce2ecf536910d052b26063bf687aa02e67`
- Fuse: RunAsNode OFF, Cookie Encryption ON, Node Options OFF, Node CLI Inspect OFF, Embedded ASAR Integrity ON, Only Load App From ASAR ON, file:// Extra Privileges OFF, Wasm Trap Handlers ON
- 아직 상용 코드서명 전이므로 이 빌드는 개발 후보이며 고객 배포 금지
