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
- [x] 업데이트 설치 전 전체 프로젝트 자동 백업·형식/크기/GZIP 검증·실패 시 설치 보류
- [x] 로컬 격리 포트에서 압축 해제본 기동·내장 런타임·두 번째 실행 E2E
- [x] 신규 공급자 키 보호 저장소 등록 및 기존 평문 키의 명시적 SecretRef 이전 흐름
- [x] Gateway 이벤트 릴레이의 OpenClaw store SecretRef 해석과 격리 저장소 smoke
- [ ] 실제 지원 이메일 확정
- [ ] Windows 코드 서명 인증서 연결 및 서명 검증
- [ ] GitHub Release에 설치 EXE·blockmap·`latest.yml` 업로드 후 업데이트 왕복 검증
- [ ] 실제 사용자 확인 후 Gateway·공급자 평문 이전 및 `openclaw secrets audit` 0건
- [ ] 결제 상품·환불 정책·세금 처리·고객 지원 SLA 확정
- [ ] 클린 Windows VM 설치/업데이트/제거 E2E 통과

`node scripts/release-check.mjs --strict`가 자동 검증 가능한 출시 차단 항목을 검사합니다. 빈 제품 메타데이터나 서명 자격증명이 있으면 정식 배포를 실패시킵니다.

GitHub Actions의 `Windows release` 수동 실행은 새 Windows runner에서 설치·실행·보안 헤더·단일 인스턴스·제거를 자동 검증합니다. `vX.Y.Z` 태그 실행은 여기에 유효한 Authenticode 서명과 GitHub Release 게시까지 추가합니다. 설정 방법은 [상용 릴리스 운영서](COMMERCIAL-RELEASE.md)를 따릅니다.

## 4.2.7 로컬 검증 기록 (2026-09-29)

- 업데이트 파일 다운로드가 끝나도 `autoInstallOnAppQuit`를 비활성 상태로 유지하고, 전체 프로젝트 보호 백업 성공 뒤에만 설치 허용
- 백업 MIME·300MB 상한·GZIP 서명·SHA-256을 검사하고 `.partial` 파일을 원자적으로 확정하거나 실패 시 제거
- 프로젝트가 없거나 원격 서버를 사용하는 클라이언트는 네트워크/파일 작업 없이 안전 사유와 함께 건너뜀
- 상태센터와 트레이에서 백업 중·백업 실패·종료 시 설치 예약 상태를 표시하고, 실패 시 설치 없이 재시도 제공
- 전체 51개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과, 웹앱·데스크톱 프로덕션/전체 빌드 npm 감사 취약점 0건
- 최종 패키지 SecretRef 저장 → 읽기 전용 감사 → Studio 런타임 해석 → 가짜 WebSocket Gateway 인증 smoke 통과
- 실제 Electron renderer → preload IPC → 읽기 전용 감사 → 4.2.7 업데이트 상태센터 UI smoke 통과
- 최종 설치본 Windows E2E 전체 통과: 설치 184.97초, 첫 준비 9.87초, HTML/PDF/PPTX 18.14초, 백업 왕복 0.39초, 런타임 복구 17.52초, 제거 12.35초, 전체 246.82초
- NSIS 패키지 `268,348,847`바이트, 런타임 파일 14,961개·필수 패키지 10개, 패키지 비밀정보 검사 0건
- 설치 파일 SHA-256: `fca3fe1ddc2d0750bb515c39865b1680c1afc26afc7a5b4ef1599fb563d615aa`
- 실제 PC 기본 경로에 4.2.7 복구 설치 후 설치 실행 파일과 `win-unpacked` 실행 파일 SHA-256 일치, 기존 사용자 바로가기 대상 유효
- 실제 바로가기 실행에서 OpenClaw `2026.9.6`·Ollama `0.34.4` 연결, `/api/agent` → `qwen3.5:4b` 32K 요청이 폴백 없이 `OK` 응답(24.60초)
- NSIS E2E가 기존 사용자 단위 설치 등록과 충돌할 수 있음을 확인하고, 설치된 PC에서는 실행을 거부해 클린 VM/CI만 허용하는 사전 안전 검사 추가
- 설치 파일과 앱 본체는 아직 상용 코드서명 전이므로 고객 배포 금지

## 4.2.6 로컬 검증 기록 (2026-09-29)

- 시스템 상태센터에서 OpenClaw·Ollama 상태를 5초, 업데이트 진행률을 1초마다 자동 갱신
- OpenClaw 비밀정보 읽기 전용 감사를 별도 worker로 실행하고 renderer에는 숫자 집계만 전달
- 실제 사용자 설정에 평문 3건이 남아 있음을 변경 없이 탐지했으며 사용자 확인 전 자동 이전 금지 경계를 유지
- 비밀 원문과 JSON 경로가 공개 감사 결과에 포함되지 않는 단위 검사 통과
- 중첩 Electron UtilityProcess에서 OpenClaw 자식 Node가 교착되던 문제를 실제 Electron UI smoke로 발견하고 외부 Node worker로 교체; renderer → preload IPC → 읽기 전용 감사 → 업데이트 상태 전체 경로 통과
- 최종 `win-unpacked`의 store SecretRef 저장 → 읽기 전용 감사 → Studio 런타임 해석 → 가짜 WebSocket Gateway 인증 smoke 통과
- 전체 45개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과, 웹앱·데스크톱 프로덕션/전체 빌드 npm 감사 취약점 0건
- 최종 해시 설치본 Windows E2E 전체 통과: 설치 236.20초, 첫 준비 8.70초, HTML/PDF/PPTX 19.53초, 백업 왕복 0.28초, 런타임 복구 12.50초, 제거 9.47초, 전체 290.63초
- 실제 PC에 4.2.6 설치 후 설치 실행 파일과 `win-unpacked` 실행 파일 SHA-256 일치, 사용자 바로가기 대상 유효
- 실제 바로가기 실행에서 OpenClaw `2026.9.6`·Ollama 연결, `/api/agent` → `qwen3.5:4b` 32K 요청이 폴백 없이 `OK` 응답(26.04초)
- NSIS 패키지 `268,346,889`바이트, 런타임 파일 14,961개·필수 패키지 10개, 패키지 비밀정보 검사 0건
- CycloneDX SBOM 웹앱 321개·데스크톱 5개 구성요소 생성, 설치 파일·blockmap·업데이트 manifest·SBOM·E2E·제3자 고지·증거 JSON 8개 SHA-256 독립 대조 통과
- `release-evidence-4.2.6.json`이 패키지/E2E 통과와 상용 차단 항목을 분리 기록하고, strict 모드는 미서명·비활성 업데이트·미입력 판매자 정보에서 의도대로 실패
- 설치 파일 SHA-256: `00e5b42b9eac395700da8cc194c7883fce42674e9b8d3d53e4cfdb2df78e50cd`
- 설치 파일과 앱 본체는 아직 상용 코드서명 전이므로 고객 배포 금지

## 4.2.5 로컬 검증 기록 (2026-09-29)

- Gateway 토큰을 OpenClaw store SecretRef 보호 대상으로 추가하고, 공식 SecretRef 런타임으로 서버 메모리에서만 해석
- 평문 Gateway 토큰을 예외 처리하던 감사를 제거해 `plaintextCount=0`만 성공으로 인정
- 실제 사용자 설정과 분리한 OpenClaw 상태 DB에서 store 저장 → SecretRef 해석 → 값 일치 smoke 통과
- 최종 `win-unpacked` Studio 런타임이 격리 store SecretRef를 해석해 가짜 WebSocket Gateway 인증까지 완료하는 패키지 smoke 통과
- 실제 4.2.5 바로가기 실행에서 이벤트 릴레이 `OpenClaw 2026.9.6` 연결 및 `/api/agent` → `ollama/qwen3.5:4b` 32K 요청 `OK` 응답(29.349초)
- 보안 경계를 벗어난 `browser-automation`·`canvas` junction을 복구용으로 보존하고 실제 디렉터리로 교체; 두 스킬 `eligible=true`·실제 AI 요청 후 invalid 경고 0건
- 전체 40개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과
- NSIS 패키지 `268,343,829`바이트, 런타임 필수 패키지 10개·파일 14,961개, 패키지 비밀정보 검사 0건
- 최종 해시 설치본 격리 E2E 전체 통과: 설치 314.81초, 첫 준비 13.23초, HTML/PDF/PPTX 44.90초, 백업 왕복 0.13초, 런타임 복구 9.69초, 제거 14.36초
- 설치본 SHA-256: `a8b156ddcae3e89a9686f915b999dc12fa34bac8e3565dfa80682b64369cfcaf`
- 실제 사용자 키 이전은 앱의 명시적 확인 이후에만 실행하도록 기존 안전장치 유지
- 설치 파일과 앱 본체는 아직 상용 코드서명 전이므로 고객 배포 금지

## 4.2.4 로컬 검증 기록 (2026-09-28)

- Ollama `0.34.4`, OpenClaw `2026.9.6` 업데이트와 OpenClaw 상태 DB·에이전트 DB·검색 플러그인 마이그레이션 완료
- 손상되지 않은 DB를 막던 0바이트 잔여 Gateway lock만 복구 폴더로 격리하고 `openclaw doctor --fix --non-interactive` 통과
- 독립 로딩 창, 숨겨진 메인 창, Studio 우선 실행, OpenClaw 앱 관리 직행·백그라운드 자동 복구·잔여 진단 프로세스 정리·재시도 상한 회귀 검사 추가
- 전체 37개 테스트·TypeScript·프로덕션 빌드·독립 런타임 smoke 통과
- 웹앱·데스크톱의 프로덕션 및 전체 빌드 npm 보안 감사 4종 모두 취약점 0건
- 기존 `🖥️ 비전엔진 데스크톱 앱.lnk` 실행에서 Studio 5199를 먼저 준비하고 OpenClaw 18789 자동 복구 성공, 기존 프로젝트 5개 보존 확인
- Ollama 사용자 컨텍스트 `32768` 적용 후 설치본 `/api/agent` → OpenClaw → `ollama/qwen3.5:4b` 실제 요청 `OK` 응답(21.447초)
- 서버 외부 import 10개만 런타임에 포함하고 React·Three.js 등 브라우저 전용 중복을 차단하는 패키지 검사 통과
- NSIS 패키지 `268,341,498`바이트(4.2.3 대비 12.1% 감소), blockmap·`latest.yml` 일치, 패키지 비밀정보 검사 0건
- 격리 설치 E2E 전체 통과: 설치 158.73초, 첫 준비 8.82초, HTML/PDF/PPTX 41.57초, 백업 왕복 0.23초, 런타임 복구 10.08초, 제거 9.41초
- 기존 4.2.3 동일 E2E의 설치 393.36초 대비 59.6% 단축; 보안 헤더·악성 Host/Origin 차단·단일 인스턴스·비파괴 복원 유지
- 설치본 SHA-256: `e71ef45a6c31f59b749f1f263cf4b1347939281446f8d05985963457af616414`
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
