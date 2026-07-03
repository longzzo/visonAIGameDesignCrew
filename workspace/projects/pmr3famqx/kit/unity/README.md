# 유니티 프로젝트 스켈레톤 — 수리검 닌자 너구리

## 폴더 구조
Assets/
├── _Project/
│   ├── Data/               # ScriptableObject 데이터
│   │   ├── SkinData.asset
│   │   ├── LevelData.asset
│   │   └── MapConfig.asset
│   ├── Scripts/
│   │   ├── Core/           # 핵심 매니저/컨트롤러
│   │   │   ├── PhysicsSkinManager.cs
│   │   │   ├── ThrowController.cs
│   │   │   └── LevelProgressionManager.cs
│   │   ├── Systems/        # 시스템 컴포넌트
│   │   │   ├── SkinEffect.cs
│   │   │   └── MapGenerator.cs
│   │   └── UI/             # UI 컨트롤러
│   │       └── TailWeightUI.cs
│   ├── Scenes/
│   │   ├── Main.unity      # 메인 레벨 (Player + Camera + UI)
│   │   ├── Menu.unity      # 홈 화면
│   │   └── Results.unity   # 전투 결과
│   ├── Resources/
│   │   └── Data/           # CSV 로드용 (LevelStats.csv, MapProbabilities.csv)
│   └── Art/                # 아트 리소스 (픽셀 아트 + 셰이더)
│       ├── Characters/
│       ├── Items/
│       └── Effects/

## 씬 구성
- Main.unity: Player (MainCamera, InputManager, PhysicsSkinManager, LevelProgressionManager, TailWeightUI)
- Menu.unity: UI Canvas (StartButton, EventBanner, SettingsButton)
- Results.unity: UI Canvas (ScoreAnimation, NextButton, MemoryText)

## 개발 순서 (P0 → P1)
1. [P0] PhysicsSkinManager + SkinData.asset 구현 → 스킨별 물리 속성 적용 (치즈/생선/김치)
2. [P0] ThrowController 구현 → 터치 슬라이드 입력 + 애니메이션 지연 (0.05s 출발만 적용)
3. [P0] LevelProgressionManager 구현 → 3라운드 클리어 시 레벨 +1, 아이템 확률 +15%
4. [P1] MapGenerator 구현 → 12x12 셀 기반 랜덤 맵 생성 (CSV 기반 확률 로드)
5. [P1] TailWeightUI 구현 → 던진 횟수에 따른 꼬리 무게 시각화 (막대기 UI)
6. [P1] UI Flow 통합 → 홈 → 전투 → 결과 → 성장 → 홈
