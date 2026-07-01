# FABLE5_MASTER_PROMPT.md — Claude Code (Fable 5)에 붙여넣는 올인원 프롬프트

> 이 프롬프트는 Claude Code를 `claude-fable-5` 모델로 실행한 뒤 **한 번만** 붙여넣으면 된다.
> Fable 5가 시스템 감지 → 설치 → 설정 → 검증 → 웹앱 구축까지 자율적으로 진행한다.
> 각 단계에서 오너(사람)에게 확인이 필요한 지점에서만 멈추고 물어본다.

---

## 붙여넣을 프롬프트

```
너는 지금부터 "Vision Engine" 프로젝트의 전체 인프라를 구축하는 역할이다.
이 프로젝트는 게임 기획 전용 멀티에이전트 웹앱을 만드는 것이 최종 목표다.
나는 Windows 사용자이고, GPT Pro 구독 전까지 로컬 AI(Ollama)로 임시 운영할 것이다.

아래 단계를 순서대로 자율적으로 진행해라. 각 단계 완료 후 결과를 간단히 보고하고,
판단이 필요한 부분에서만 나에게 물어라. 사소한 것은 네가 판단하고 진행해라.

=== 1단계: 시스템 감지 ===
- 내 PC의 GPU 모델, VRAM 용량, RAM, OS 버전을 자동으로 감지해라.
  (Windows 명령어: nvidia-smi, wmic, systeminfo 등 활용)
- 감지된 VRAM에 따라 적합한 Ollama 모델을 자동으로 선택해라:
  - 8GB 이하: qwen3.6:9b 또는 llama3.2:3b
  - 16GB: qwen3.6:27b-q4_K_M
  - 24GB+: qwen3.6:27b 또는 deepseek-r1:32b
  - GPU 없음/감지 실패: CPU 모드로 llama3.2:3b
- 선택한 모델과 이유를 나에게 보고해라.

=== 2단계: Ollama 설치 및 모델 다운로드 ===
- Ollama가 이미 설치되어 있는지 확인해라 (ollama --version).
- 없으면: winget이나 직접 다운로드 URL(https://ollama.com/download/windows)을
  안내하고, 설치 완료 후 다음 단계로 넘어가라.
  (Ollama 설치는 GUI 인스톨러라 내가 직접 해야 할 수 있다 — 그 경우 안내만 해라.)
- 설치 확인 후: 1단계에서 선택한 모델을 `ollama pull [모델명]`으로 다운로드해라.
- 다운로드 완료 후 `ollama list`로 확인하고 보고해라.
- `http://localhost:11434`에 Ollama API가 응답하는지 확인해라.

=== 3단계: OpenClaw 설치 ===
- Node.js 22 이상이 설치되어 있는지 확인해라 (node -v).
  없으면 설치 방법을 안내해라.
- `npm install -g openclaw@latest`로 OpenClaw를 설치해라.
- `openclaw onboard --install-daemon`으로 게이트웨이 데몬을 설치해라.
- 온보딩 중 인증 방식은 "ollama" (로컬)로 선택해라.
  (대화형 프롬프트가 뜨면 나에게 뭘 선택할지 안내해라.)

=== 4단계: OpenClaw + Ollama 연결 ===
- ~/.openclaw/openclaw.json (또는 해당 설정 파일)에 Ollama 프로바이더를 설정해라:
  {
    "models": {
      "providers": {
        "ollama": {
          "baseUrl": "http://127.0.0.1:11434/v1",
          "apiKey": "ollama-local",
          "api": "openai-responses",
          "models": [{
            "id": "[1단계에서 선택한 모델]",
            "name": "[모델 이름]",
            "contextWindow": 32768,
            "maxOutput": 8192
          }]
        }
      }
    },
    "agents": {
      "defaults": {
        "model": {
          "primary": "ollama/[1단계에서 선택한 모델]"
        }
      }
    }
  }
- 설정 후 게이트웨이를 재시작하고, `http://127.0.0.1:18789`에
  WebChat이 뜨는지 확인해라.
- WebChat에서 간단한 테스트 메시지("안녕, 너는 누구야?")를 보내
  로컬 모델이 응답하는지 확인해라.

=== 5단계: Vision Engine 에이전트 설정 ===
- 이 프로젝트 폴더(vision-engine/)의 config/openclaw.json을 참고해
  실제 ~/.openclaw/ 설정에 8개 에이전트(pm, scenario, gameplay, uiux,
  systems, balance, bm, visual)를 등록해라.
- 각 에이전트의 instructionsFile은 agents/*/AGENTS.md를 가리킨다.
- 모델은 전부 ollama/[선택한 모델]로 통일한다.
- bm 에이전트만 tools.deny로 exec, write를 막는다.
- 설정 후 게이트웨이 재시작하고, WebChat에서 PM에게
  "스모크 테스트: 간단한 판타지 게임 컨셉 하나 잡아줘"라고 보내
  응답이 오는지 확인해라.

=== 6단계: 커스텀 웹앱 프론트엔드 구축 ===
이제 핵심이다. 기본 WebChat 대신, 모티브 영상
(여러 AI 에이전트가 각자 파트를 맡아 동시에 작업하는 모습이 보이는 UI)처럼
게임 기획 전용 웹앱을 만들어라.

기술 스택:
- 프론트엔드: React (또는 네가 더 적합하다 판단하는 것)
- 백엔드 연결: OpenClaw 게이트웨이의 WebSocket (ws://127.0.0.1:18789)
- 로컬 전용 (localhost)

필수 UI 요소:
1. 왼쪽 사이드바: 8개 에이전트 목록 (아이콘 + 이름 + 상태 표시등)
2. 중앙 메인 패널: 현재 선택한 에이전트와의 대화 또는 통합 뷰
3. 오른쪽 패널: 마스터 GDD 실시간 미리보기 (마크다운 렌더링)
4. 상단 바: 프로젝트 이름, 현재 모델 표시, 비용/토큰 카운터
5. "오케스트레이션 뷰": PM에게 요청하면 어떤 서브에이전트가
   작업을 받았는지, 진행 중인지, 완료됐는지 실시간으로 보이는 카드 UI
6. 다크 모드 기본

선택 UI 요소 (시간이 되면):
- 에이전트 간 메시지 흐름을 시각화하는 간단한 플로우 애니메이션
- GDD 섹션별 편집 모드
- 에이전트 응답을 GDD에 드래그앤드롭으로 반영하는 기능

이 웹앱의 소스코드를 vision-engine/webapp/ 디렉터리에 만들어라.
package.json, 빌드 스크립트, README 포함.
완성되면 `npm run dev`로 실행할 수 있게 해라.

=== 7단계: 최종 검증 및 보고 ===
- 웹앱을 실행하고, PM 에이전트에게 간단한 기획 요청을 보내
  전체 파이프라인이 작동하는지 확인해라.
- 작동하면: 최종 보고서를 작성해라 (설치된 것, 설정된 것, 접속 URL, 알려진 제한).
- 실패하면: 어디서 막혔는지, 무엇이 필요한지 정리해서 나에게 알려라.

=== 전역 규칙 ===
- GUI 인스톨러가 필요한 단계(Ollama, Node.js 등)는 나에게 안내하고 기다려라.
- CLI로 해결 가능한 건 직접 실행해라.
- 에러가 나면 3번까지 자동으로 재시도하고, 그래도 안 되면 나에게 보고해라.
- 각 단계 완료마다 "✅ N단계 완료" 형식으로 짧게 보고해라.
- 나에게 한 번에 3개 이상 질문하지 마라.
- 설치 과정에서 개인정보나 API 키를 외부로 보내지 마라.

지금 1단계부터 시작해라.
```

---

## 참고: GPT Pro 전환 시

나중에 GPT Pro를 구독하면, OpenClaw 설정에서 모델만 바꾸면 된다:

```bash
# OAuth 인증 추가
openclaw onboard --auth-choice openai-codex

# 모델을 GPT Pro로 전환
openclaw config set agents.defaults.model.primary "openai-codex/gpt-5.3-codex"

# 게이트웨이 재시작
openclaw gateway restart
```

웹앱 코드는 건드릴 필요 없이, 백엔드 모델만 교체하면 그대로 작동한다.

## 참고: Claude Fable 5로 전환 시

Claude API 키를 직접 쓰고 싶으면:

```bash
# 모델을 Fable 5로 전환
openclaw config set agents.defaults.model.primary "anthropic/claude-fable-5"

# API 키 설정
openclaw config set models.providers.anthropic.apiKey "sk-ant-..."

# 게이트웨이 재시작
openclaw gateway restart
```
