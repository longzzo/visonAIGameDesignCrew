# Vision Engine

게임 기획 전용 멀티에이전트 스튜디오. 로컬 AI(Ollama)로 8개 기획 에이전트를 운영한다.

## 🚀 실행 (원클릭)

| 파일 | 용도 |
|---|---|
| **`VisionEngine-Start.bat`** | 더블클릭 → Ollama(D경로 자가치유) → 게이트웨이 → 웹앱 순서로 확인·기동 후 브라우저 자동 오픈 |
| **`VisionEngine-Mobile.bat`** | 위와 동일하되 웹앱을 Tailscale 주소에 바인딩 (폰 접속용) |

이미 떠 있는 것은 건너뛰므로 **아무 때나 다시 눌러도 안전**하다.
웹앱만 끄려면 "Vision Engine 웹앱" 제목의 검은 창을 닫으면 된다(게이트웨이·Ollama는 유지).

```
vision-engine/
├─ agents/            # 에이전트별 워크스페이스 (AGENTS.md = 각 에이전트 지침서)
│  ├─ pm/             # 🎯 총괄 PM (GDD 통합, 기본 에이전트)
│  ├─ scenario/       # 📖 세계관·스토리
│  ├─ gameplay/       # 🕹️ 코어 루프·메커니크
│  ├─ systems/        # ⚙️ 성장·경제 시스템
│  ├─ uiux/           # 🧭 UI/UX·온보딩
│  ├─ balance/        # ⚖️ 수치·난이도
│  ├─ bm/             # 💰 수익모델 (exec/write/edit 금지 = 조언 전용)
│  └─ visual/         # 🎨 아트 디렉션
├─ config/openclaw.json   # 참조용 설정 (실제 적용: ~/.openclaw/openclaw.json)
├─ workspace/GDD.md       # 마스터 GDD (웹앱이 실시간 갱신)
├─ webapp/                # 커스텀 웹앱 (npm run dev → http://127.0.0.1:5199)
└─ bin/openclaw.cmd       # 일반 터미널용 OpenClaw CLI 래퍼
```

## 스택

| 구성 | 값 |
|---|---|
| LLM | Ollama `qwen3:8b` (D:\Ollama\models, 8GB VRAM 전용) · 예비 `qwen2.5:7b-instruct` |
| 게이트웨이 | OpenClaw 2026.6.11 — Windows 예약작업 "OpenClaw Gateway"로 자동 실행, `ws://127.0.0.1:18789` (토큰 인증, 루프백 전용) |
| 기본 WebChat | http://127.0.0.1:18789 (openclaw dashboard) |
| 커스텀 웹앱 | React + Vite + zustand, `webapp/` 참고 |

## 📱 모바일 디스패치 (Tailscale)

폰에서 이 PC의 에이전트를 굴리는 방법. **이 PC가 켜져 있고 게이트웨이가 돌고 있어야** 하며,
실제 연산은 PC의 GPU(qwen3:8b)에서 일어난다 — 폰은 리모컨이다.

```powershell
openclaw daemon status          # stopped면 openclaw daemon start
cd D:\Claude\vision-engine\vision-engine\webapp
npm run dev:mobile              # Tailscale IP(100.114.32.46:5199)에만 바인딩
```

- 폰(Tailscale 앱 로그인)에서 브라우저로 **http://100.114.32.46:5199** 접속.
  (이 PC Tailscale 이름 `longzzolap`, 폰 `s25-ultra` = 100.122.207.32)
- 게이트웨이는 계속 loopback(127.0.0.1)에 있고 Vite 웹앱이 서버측에서 프록시 → 게이트웨이 자체는 외부 비노출.
- 평소엔 `npm run dev`(로컬 전용), 폰 쓸 때만 `npm run dev:mobile`(tailnet 노출).

> ⚠️ 보안: dev:mobile은 Tailscale 네트워크(본인 기기들)에만 열린다. 웹앱 실행 브리지가 PC에서
> 코드를 실행할 수 있으니 tailnet에 신뢰하지 않는 기기를 두지 말 것. tailnet IP가 다르면
> `tailscale ip -4`로 확인 후 주소를 바꾼다.

## 자주 쓰는 명령

```powershell
# 게이트웨이 서비스
openclaw daemon status | start | stop | restart
openclaw status                 # 전체 상태
openclaw agents list            # 8개 에이전트 확인
openclaw agent --agent pm -m "메시지"   # CLI로 1턴 실행

# Ollama가 모델을 못 찾을 때 (D경로로 재기동)
Get-Process *ollama* | Stop-Process -Force; $env:OLLAMA_MODELS='D:\Ollama\models'; Start-Process ollama serve
```

> `openclaw` 명령이 일반 터미널에서 안 잡히면 `vision-engine\bin\openclaw.cmd` 를 사용하거나
> 일반 터미널에서 `npm i -g openclaw` 로 재설치.

## 에이전트 지침 수정

`agents/<id>/AGENTS.md` 를 편집하면 다음 대화부터 반영된다(게이트웨이 재시작 불필요).
모델 교체는 `~/.openclaw/openclaw.json` 의 `agents.defaults.model.primary` 와 각 에이전트 `model` 수정 후
`openclaw daemon restart`.
