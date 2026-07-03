# 🚀 Vision Engine 시작 가이드 (처음 쓰는 사람용)

> **Vision Engine이 뭔가요?** — 게임 아이디어 한 줄을 넣으면, AI 에이전트 12명(PM·시나리오·게임플레이·시스템·UI/UX·밸런스·BM·아트·선임 개발자·스케줄러·마케팅·QA)이 픽셀아트 사무실에서 회의하고, 게임 기획서(GDD)를 쓰고, 서로 검토·채점하고, 마지막엔 **유니티 개발 문서 + 밸런스 CSV + 에셋 목록 + C# 스켈레톤 + 플레이 가능한 프로토타입**을 ZIP 하나로 뽑아주는 1인 게임 기획 스튜디오입니다.
>
> 전부 **무료로** 돌릴 수 있습니다 (로컬 모델 + 무료 클라우드 크레딧). API 키는 이 저장소에 없으며, 여러분의 PC(`~/.openclaw`)에만 저장됩니다.

---

## 1. 준비물

| 항목 | 필수? | 비고 |
|---|---|---|
| Windows 10/11 PC | ✅ | 런처(.bat)가 Windows 기준. macOS/리눅스는 수동 실행 필요 |
| [Node.js](https://nodejs.org) 20+ | ✅ | 웹앱과 OpenClaw 실행 |
| [Ollama](https://ollama.com) | ✅ | 무료 로컬 AI 모델 (VRAM 8GB 권장) |
| [Git](https://git-scm.com) | ✅ | 저장소 받기 |
| NVIDIA NIM API 키 | 선택 | [build.nvidia.com](https://build.nvidia.com) 무료 발급 — 회의 품질·속도가 크게 좋아짐 |
| Stable Diffusion (Forge) | 선택 | 아트 인턴이 컨셉 아트·사무실 배경을 그림 (GPU 필요) |
| [Tailscale](https://tailscale.com) | 선택 | 폰/노트북에서 접속하고 싶을 때 |
| [Obsidian](https://obsidian.md) | 선택 | 노트로 지식 학습 + 산출물 자동 아카이브 |

---

## 2. 설치 (약 15분)

### ① 저장소 받기

```bat
git clone https://github.com/longzzo/visonAIGameDesignCrew.git vision-engine
cd vision-engine
```

### ② Ollama + 로컬 모델

1. [ollama.com](https://ollama.com)에서 설치
2. 모델 받기 (기본 무료 모델):
   ```bat
   ollama pull qwen3:8b
   ```
3. (선택) 모델을 D드라이브에 두려면 — 시스템 환경변수 `OLLAMA_MODELS=D:\Ollama\models` 설정 후 Ollama 재시작

### ③ OpenClaw (에이전트 게이트웨이)

```bat
npm install -g openclaw
openclaw onboard
```

- 온보딩 마법사에서 **로컬 모드**를 선택하면 게이트웨이가 Windows 예약작업(`OpenClaw Gateway`, 포트 18789)으로 등록됩니다.
- 마법사가 묻는 모델은 아무거나 골라도 됩니다 — 다음 단계에서 우리 설정으로 덮어씁니다.

### ④ 에이전트 12명 설정 (자동)

```bat
node scripts\setup-openclaw.mjs
```

- 이 저장소의 `config/openclaw.json` 템플릿을 여러분의 `~/.openclaw/openclaw.json`에 적용합니다.
- 이미 등록된 API 키·토큰이 있으면 **그대로 보존**하고, 기존 설정은 자동 백업됩니다.
- 끝나면 게이트웨이 재시작:
  ```bat
  schtasks /End /TN "OpenClaw Gateway" & schtasks /Run /TN "OpenClaw Gateway"
  ```

### ⑤ 웹앱 의존성

```bat
cd webapp
npm install
cd ..
```

### ⑥ 실행!

**`VisionEngine-Start.bat` 더블클릭.** 이게 전부입니다. 런처가 Ollama → 게이트웨이 → 웹앱 → (있으면) Stable Diffusion 순서로 알아서 켜고 브라우저를 엽니다.

- Tailscale이 있으면 자동으로 모든 기기에서 접속 가능한 주소로 뜹니다. 없으면 PC 전용(`127.0.0.1:5199`)으로 뜹니다.
- 창을 열어두면 **워치독**이 30초마다 감시해서 죽은 서비스를 자동으로 되살립니다.
- PC 전용으로만 쓰려면 `VisionEngine-Local.bat`.

---

## 3. 첫 5분 — 이렇게 써보세요

1. 상단에서 **＋** 눌러 새 프로젝트 만들기
2. 입력창에 아이디어 한 줄 — 예: `"달빛 아래에서만 힘이 강해지는 너구리 닌자 로그라이크"`
3. **🎪 풀 기획 회의** 클릭 → **🏢 사무실** 탭으로 가서 구경하세요. 캐릭터들이 일하고, 말풍선으로 실시간 작업이 보이고, QA 디렉터가 부실한 산출물을 반려시키는 것까지 보입니다.
4. 회의가 끝나면:
   - **📄 GDD** — 완성된 기획서 (섹션별 담당자 표시)
   - **🔍 이번 회의 변경 확인** — 뭐가 바뀌었는지 diff, 마음에 안 들면 **⏪ 되돌리기**
   - **📋 보고서함** — 회의록 자동 저장
5. 기획이 어느 정도 차면 **📦 개발 착수 킷** 클릭 → 유니티 문서·밸런스 CSV·에셋 목록·C# 스켈레톤·플레이 가능한 그레이박스가 생성되고 **ZIP으로 다운로드**됩니다.

### 화면 구성

| 탭 | 용도 |
|---|---|
| 🗂️ 오케스트레이션 | 지시 내리기, 회의 진행 상황, 대화 피드, 개발 착수 킷 |
| 💬 에이전트 채팅 | 특정 팀원과 1:1 대화 (결론은 PM 검증 후 GDD 반영 가능) |
| 🏢 사무실 | 픽셀아트 사무실 — 팀원 상태·말풍선·회의실·아트/개발 인턴 책상 |

### 알아두면 좋은 버튼

- **☀️ 오늘의 브리핑** — PM이 현황·오늘 할 일 3가지·리스크를 보고 (매일 아침 한 번)
- **📥 기존 기획 리뷰** (사무실 헤더) — 이미 있는 기획을 팀 전체가 학습하고 보완점·평가를 돌려줌
- **📥 문서 가져오기** — 갖고 있던 기획 문서(.md/.txt)를 팀에게 먹이기
- **🤝 협업 세션** — 팀원 2~4명이 서로 토론해서 결론 도출
- **🖌️ 아트 인턴** (사무실) — 컨셉 아트·사무실 배경 생성 (SD 필요)
- **🧑‍💻 개발 인턴** (사무실) — 기능별 HTML 프로토타입 (🕹️ 플레이어블 토글 = 조작 가능한 그레이박스)
- **📚 지식 학습** (사이드바) — 기획 이론을 가르치면 관련 회의에서 자동 참고

---

## 4. 더 좋게 쓰기 (선택)

### 클라우드 모델 (강력 추천 — 무료)

로컬 8B 모델은 느리고 품질이 낮습니다. [build.nvidia.com](https://build.nvidia.com)에서 무료 키를 발급받아:

1. 사이드바 **🔑** 버튼 → NVIDIA 키 등록
2. 사이드바 **🧠 AI 모델** → `Kimi K2.6`(PM 추천) 또는 `Qwen3 Next 80B`(팀원 추천) 선택
3. "⚙️ 역할별 모델"에서 PM만 강한 모델로 배정하는 것도 가능
4. 클라우드 모델이면 **동시** 값을 4~7로 올려 전원이 진짜 동시에 일하게 하세요

> GitHub Models 무료 티어는 요청당 4,000토큰 제한이라 **사용 불가**합니다 (유료 결제 시에만 가능). NVIDIA가 무료 대안입니다.

### 웹 검색

기본으로 DuckDuckGo 검색이 켜져 있습니다 (키 불필요). 마케팅 담당관은 웹 조사가 기본 업무입니다.

### 아트 인턴 (Stable Diffusion)

사무실 → 아트 인턴 책상 클릭 → 설치 안내를 따라 **SD WebUI Forge** + DreamShaper 8 설치 (무료, RTX 8GB면 충분). 주소가 기본(`127.0.0.1:7860`)과 다르면 환경변수 `VE_SD_URL`로 지정.

### 폰에서 쓰기

PC와 폰에 [Tailscale](https://tailscale.com) 설치 + 같은 계정 로그인 → `VisionEngine-Start.bat` 실행 → 런처가 표시하는 `http://100.x.x.x:5199` 주소를 폰에서 열기. 폰에는 열람·실행만 주고 싶으면 환경변수 `VE_REMOTE_MODE=readonly`.

### 옵시디안 연동

옵시디안에서 볼트를 열어두면 자동 감지됩니다. 노트에 `#ve-학습` 태그를 달면 **📚 지식 학습** 창에 나타나고, GDD·보고서는 볼트의 `VisionEngine/` 폴더에 자동 아카이브됩니다.

---

## 5. 자주 막히는 곳 (FAQ)

**Q. 상단 신호등이 🔴이에요**
게이트웨이가 죽은 것 — 신호등 클릭 → 재시작. 또는 `schtasks /Run /TN "OpenClaw Gateway"`.

**Q. Ollama 모델이 0개래요**
모델이 다른 경로에 설치된 경우입니다. 런처가 자동으로 고치지만, 안 되면 트레이 아이콘에서 Ollama Quit 후 런처 재실행.

**Q. 회의가 너무 느려요**
로컬 모델의 숙명입니다. ① NVIDIA 키 등록(무료)이 최선 ② 교차 검토·QA 게이트를 끄면 호출 수가 1/3로 줄어듭니다 ③ 로컬 모델은 "동시 1"을 유지하세요.

**Q. 에이전트가 이상한 답을 하거나 빈 답을 줘요**
🩺 **에이전트 전원 점검**(사이드바)으로 12명 생존 확인. 특정 모델이 과부하일 수 있으니 다른 모델로 바꿔보세요.

**Q. 회의가 GDD를 망쳤어요**
**🔍 이번 회의 변경 확인** → **⏪ 회의 전으로 되돌리기**. GDD는 저장 때마다 자동 백업되며 📄 GDD 패널의 히스토리에서 언제든 복원 가능합니다.

**Q. API 키는 어디에 저장되나요?**
`~/.openclaw/openclaw.json`에만 저장됩니다 (평문이므로 PC 공유 시 주의). 이 저장소에는 키가 절대 커밋되지 않습니다 — `config/openclaw.json`은 플레이스홀더 템플릿입니다.

---

## 6. 폴더 구조 한눈에

```
vision-engine/
├── VisionEngine-Start.bat      ← ★ 실행 (Tailscale 자동, 없으면 PC 모드)
├── VisionEngine-Local.bat      ← PC 전용 실행 (원격 차단)
├── GETTING-STARTED.md          ← 이 문서
├── ROADMAP.md                  ← 버전별 기능 이력 (v0.1 ~ v1.7)
├── config/openclaw.json        ← 에이전트 12명 설정 템플릿 (키 없음)
├── scripts/
│   ├── setup-openclaw.mjs      ← 템플릿 → ~/.openclaw 적용 (키 보존)
│   └── start-vision-engine.ps1 ← 런처 본체 (자가치유 + 워치독)
├── agents/<id>/AGENTS.md       ← 각 에이전트의 역할 지침
├── webapp/                     ← React 웹앱 + 로컬 API 서버
└── workspace/projects/<id>/    ← 프로젝트 데이터 (GDD·보고서·아트·킷·결정원장)
```

즐거운 기획 되세요! 🎮
