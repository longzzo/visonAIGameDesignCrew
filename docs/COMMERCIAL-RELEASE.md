# Vision Engine 상용 릴리스 운영서

이 문서는 개발 후보를 실제 고객에게 판매 가능한 Windows 릴리스로 승격하는 절차다. 자동화 가능한 검증은 `.github/workflows/windows-release.yml`이 담당하고, 판매자 신원·인증서·정책처럼 사람이 확정해야 하는 값은 `config/product.json`에 기록한다.

## 1. 판매자 정보 확정

`config/product.json`의 다음 값을 실제 공개 정보로 채운다.

- `legalName`: 계약·영수증에 표시할 법적 사업자/개인 이름
- `sellerCountry`: ISO 3166-1 alpha-2 국가 코드(예: `KR`)
- `supportEmail`: 고객 지원 이메일
- `websiteUrl`: 제품 공식 HTTPS 페이지
- `privacyUrl`: 공개 개인정보 처리방침
- `termsUrl`: 공개 이용약관/EULA
- `refundPolicyUrl`: 공개 환불 정책
- `supportPolicyUrl`: 지원 범위·운영시간·연락 방법
- `supportResponseHours`: 영업시간 기준 최초 응답 목표(시간)

결제 대행사 또는 판매 플랫폼에서 환불·세금을 처리하더라도 고객이 구매 전에 확인할 수 있는 공개 URL을 넣어야 한다. 법률·세무 문구는 판매 국가의 전문가 검토를 거친다.

## 2. Windows 코드 서명 준비

GitHub 저장소 Actions Secrets에 다음 값을 저장한다.

- `WINDOWS_CSC_LINK`: electron-builder가 지원하는 PFX 파일 경로/URL 또는 Base64 데이터
- `WINDOWS_CSC_KEY_PASSWORD`: PFX 암호

태그 릴리스는 서명이 `Valid`가 아니면 `verify-package.mjs --strict-signing` 단계에서 실패한다. 인증서·암호는 저장소 파일이나 로그에 넣지 않는다.

## 3. 업데이트 채널 활성화

1. `desktop/package.json`의 버전을 올린다.
2. `config/product.json`의 `updateUrl`과 `desktop.package.json > build.publish[0].url`이 같은 HTTPS 주소인지 확인한다.
3. GitHub Releases를 업데이트 서버로 쓸 경우 `VisionEngine-Setup-x.y.z.exe`, `.blockmap`, `latest.yml`을 모두 게시한다.
4. 첫 배포 자산 준비 후 `updatesEnabled`를 `true`로 바꾼다.
5. `node scripts/release-check.mjs --strict`를 통과시킨다.

`latest.yml`만 교체하고 설치 파일 또는 blockmap을 누락하면 업데이트가 실패한다. 릴리스 워크플로는 세 파일을 한 릴리스에 함께 게시한다.

## 4. 클린 Windows 검증과 게시

태그 없이 GitHub Actions의 `Windows release`를 수동 실행하면 unsigned 설치 후보를 클린 Windows runner에서 다음 순서로 검증한다.

1. 잠금 파일 기반 의존성 설치
2. 타입 검사·단위 테스트·웹 빌드·독립 런타임 smoke
3. NSIS 설치본과 Electron Fuse·법적 문서·업데이트 해시 검증
4. 임시 경로 무인 설치
5. 격리 userData와 포트로 앱 실행
6. 설치본에서 HTML·PDF·PPTX 발표자료 실제 렌더링
7. 전체 프로젝트 백업 생성과 동일 프로젝트 비파괴 복원
8. 준비 API·보안 헤더·Host/Origin 차단·단일 인스턴스 검증
9. 내장 Studio 런타임 강제 종료 후 데스크톱 감독 프로세스의 자동복구 검증
10. 무인 제거 및 실행 파일 삭제 확인
11. EXE·blockmap·`latest.yml`·SBOM·SHA-256·E2E 보고서 보관

OpenClaw 또는 외부 모델 카탈로그가 바뀐 릴리스는 클린 VM 검사와 별도로, 실제 공급자 `/models` 목록과 앱의 `/api/agent` 경유 한국어 응답을 확인한다. OpenClaw 내장 카탈로그만으로 제공 여부를 판단하지 않는다.

정식 게시 시 `desktop/package.json` 버전과 동일한 `vX.Y.Z` 태그를 푸시한다. 모든 게이트와 코드 서명이 통과한 경우에만 GitHub Release가 만들어진다.

## 5. 업데이트 왕복 검증

자동 업데이트 완료 증거는 서로 다른 두 버전이 필요하다.

1. 서명된 기준 버전을 클린 VM에 설치한다.
2. 패치 버전을 올려 새 태그 릴리스를 게시한다.
3. 기준 버전 앱에서 업데이트 확인 → 다운로드 → 재시작 설치를 수행한다.
4. 새 버전, 프로젝트 보존, 서명 상태, 롤백 금지, 제거를 확인한다.

이 왕복 검증 전에는 `docs/RELEASE-GATES.md`의 자동 업데이트 항목을 완료 처리하지 않는다.

## 6. OpenClaw 비밀키 이전

고객 배포 이미지나 지원 보고서에 비밀값을 포함하지 않는다. 4.2.5부터 Gateway 토큰과 앱에서 등록하는 GitHub Models·NVIDIA·Brave 키는 `openclaw secrets store`에 stdin으로 전달되고 설정에는 store SecretRef만 기록된다. 기존 평문 값은 **⚙️ PC 준비 → 평문 키 자동 보호**에서 사용자가 명시적으로 동의한 뒤 이전한다. 이전은 OpenClaw 공식 plan dry-run/apply와 롤백 절차를 사용하며 설정·환경 파일·인증 캐시를 감사한다.

고급 설정은 앱의 `고급 비밀키 설정` 또는 `openclaw secrets configure`를 사용한다. 이벤트 릴레이는 설치된 OpenClaw의 공식 SecretRef 런타임을 동적으로 불러 토큰을 서버 메모리 안에서만 해석하며, 브라우저·로그·지원 보고서에는 토큰을 전달하지 않는다. 상용 출시 전 사용자가 명시적으로 이전을 실행한 뒤 `openclaw secrets audit --json`의 `plaintextCount`가 0인지 확인한다.

## 배포 중단 조건

- 출시 게이트 실패
- Authenticode 서명이 `Valid`가 아님
- 태그와 앱 버전 불일치
- 클린 Windows E2E 실패
- 평문 비밀키 또는 고객 데이터가 설치 자산에 포함됨
- 공개 약관·환불·개인정보·지원 URL 미확정
