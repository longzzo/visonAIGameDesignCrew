# Vision Engine 상용 출시 게이트

## 반드시 통과해야 하는 항목

- [x] 설치형 Windows 앱과 비파괴 사용자 데이터 이전
- [x] Electron renderer sandbox·context isolation·권한 거부·탐색 제한
- [x] 로컬 API Host/Origin 검증과 보안 응답 헤더
- [x] 웹앱·Electron 셸·설치 런타임 프로덕션 npm 취약점 moderate/high/critical 0건
- [x] 진단 로그 회전 및 비밀값을 제외한 지원 보고서
- [x] EULA·개인정보 안내·보안 신고 정책 초안
- [x] Electron 44 + 전체 Fuse 명시(새 Fuse 추가 시 빌드 실패)
- [x] ASAR 무결성·RunAsNode·Node 옵션/디버거·file:// 추가 권한 제한
- [x] 앱 내부 자동 업데이트 확인·다운로드·재시작 설치 흐름
- [x] 로컬 격리 포트에서 압축 해제본 기동·내장 런타임·두 번째 실행 E2E
- [ ] 실제 지원 이메일 확정
- [ ] Windows 코드 서명 인증서 연결 및 서명 검증
- [ ] GitHub Release에 설치 EXE·blockmap·`latest.yml` 업로드 후 업데이트 왕복 검증
- [ ] OpenClaw 평문 자격증명 SecretRef 이전 및 감사 0건
- [ ] 결제 상품·환불 정책·세금 처리·고객 지원 SLA 확정
- [ ] 클린 Windows VM 설치/업데이트/제거 E2E 통과

`node scripts/release-check.mjs --strict`가 자동 검증 가능한 출시 차단 항목을 검사합니다. 빈 제품 메타데이터나 서명 자격증명이 있으면 정식 배포를 실패시킵니다.

## 4.0.0 로컬 검증 기록 (2026-09-10)

- Electron `44.3.0`, 제품/파일 버전 `4.0.0`
- 테스트 포트 `5299`, 별도 userData, OpenClaw 설정·데이터 이전 비활성 조건에서 내장 서버 연결 성공
- 두 번째 실행 프로세스 즉시 종료, 기존 프로세스 수 유지
- Fuse: RunAsNode OFF, Cookie Encryption ON, Node Options OFF, Node CLI Inspect OFF, Embedded ASAR Integrity ON, Only Load App From ASAR ON, file:// Extra Privileges OFF, Wasm Trap Handlers ON
- 아직 상용 코드서명 전이므로 이 빌드는 개발 후보이며 고객 배포 금지
