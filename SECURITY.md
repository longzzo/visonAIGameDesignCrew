# Security Policy

## 지원 범위

보안 수정은 현재 판매 중인 최신 Vision Engine Desktop 메이저 버전과 직전 메이저 버전에 제공하는 것을 목표로 합니다.

## 취약점 신고

취약점은 공개 이슈에 비밀정보나 재현용 키를 올리지 말고 구매 페이지 또는 구매 영수증에 표시된 비공개 지원 채널로 신고해 주세요. 다음 정보를 포함하면 대응에 도움이 됩니다.

- 영향을 받는 앱 버전과 Windows 버전
- 재현 단계와 예상 영향
- 최소한의 로그 또는 진단 보고서
- 공개 가능 시점 제안

API 키, Gateway 토큰, 개인 프로젝트 원문은 제거하거나 마스킹해야 합니다.

## 제품 보안 기준

- Renderer sandbox, context isolation, navigation 제한 및 IPC 발신자 검증
- 로컬 API Host/Origin 검증과 쓰기 요청 보호
- 배포 전 프로덕션 의존성 고·치명 취약점 0건
- Windows 설치 파일 코드 서명과 ASAR 무결성 검증
- 비밀값 평문 잔존 감사 및 SecretRef 사용
