# VE 개발 회의 장애 보고 (2026-08-11) — 실측

> 냥빙고 「제작기 티어」 회의를 돌리려다 발견. **전부 재현했고 원인까지 코드 라인으로 확인**했습니다.
> 결론부터: **개발 회의(`/api/dev-meeting`)는 지금 상태로는 아무도 못 씁니다.** 세 개가 겹쳐 있었습니다.

---

## 요약

| # | 증상 | 원인 | 상태 |
|---|---|---|:--|
| **1** | 개발 작업·회의 API가 **HTTP 403** | tailnet 노출 모드에서는 **loopback 요청이 아예 존재할 수 없다** | ⬜ 오너 판단 |
| **2** | 회의가 끝나는데 **결과가 빈 문자열**, 판정은 **`✅ 통과`** | `max_tokens: 2048` 고정 + 추론형 모델 | ✅ **고침** |
| **3** | 모델 호출 **HTTP 410** | 코드 폴백 모델이 **EOL** | ✅ **고침** |
| **4** | 에이전트 **도구 0개** → 파일을 못 읽음 | `config/mcp.json` **5개 서버 전부 `enabled: false`** | ⬜ 오너 판단 |
| **5** | 켜도 기획 에이전트는 여전히 도구 0개 | 기본 배정 목록에 **`systems`·`balance`·`gameplay`가 없다** | ⬜ 오너 판단 |
| **6** | 빈 결과에 **통과 판정** | 판정이 정규식 하나뿐 | ⬜ 제안만 |

---

## 1. 🔴 HTTP 403 — tailnet 모드에서는 개발 회의가 **구조적으로 불가능**

**증상**: `POST /api/dev-meeting` → `403 {"error":"보안: 개발 작업(실파일 관여)은 PC에서만 실행할 수 있습니다"}`

**원인 사슬**

```
VisionEngine-Mobile.bat (VE_EXPOSE=tailnet)
  → vite.config.ts:4641 resolveDevHost()  →  "100.114.32.46" 반환
  → vite server.host = 100.114.32.46      →  127.0.0.1 에는 아예 바인딩 안 됨
  → vite.config.ts:1404 isLocalReq(req)   →  remoteAddress 가 100.114.32.46 이라 항상 false
  → vite.config.ts:4746 가드              →  403
```

실측:
```
netstat →  TCP 100.114.32.46:5199 LISTENING     (127.0.0.1:5199 없음)
curl 127.0.0.1:5199   →  000 (연결 실패)
curl 100.114.32.46:5199/api/dev-meeting  →  403
```

> ⚠️ **이건 "폰에서만 막힌다"가 아닙니다.** loopback에 바인딩 자체가 안 되므로 **PC 브라우저로 열어도 403**입니다. tailnet 모드로 켜 두신 동안 **개발 작업·회의 버튼 전체가 죽어 있습니다.**

**선택지 3개** (오너 판단)

| 안 | 방법 | 잃는 것 |
|---|---|---|
| ㉠ PC 모드로 켤 때만 회의 | `VisionEngine-Local.bat` (127.0.0.1) | **폰 접속** |
| ㉡ **loopback도 함께 바인딩** | `resolveDevHost()`가 tailnet일 때 `0.0.0.0` 반환하도록. 그러면 PC는 loopback으로 붙어 `isLocalReq`가 참이 되고 **폰은 계속 tailnet으로 붙되 개발 작업만 막힌다** | 없음 — **이게 원래 의도한 동작으로 보입니다** |
| ㉢ 원격도 허용 | `VE_ALLOW_REMOTE_DEVTASK=1` | 폰에서도 **실파일 쓰기**가 가능해짐 |

**㉡을 권합니다.** 가드의 취지("폰에서는 파일 못 건드리게")를 유지하면서 PC에서는 정상 동작합니다. 다만 `0.0.0.0`은 **같은 네트워크의 다른 기기에도 노출**되므로 오너 확인 없이 바꾸지 않았습니다.

---

## 2. ✅ 빈 결과에 `✅ 통과` — `max_tokens: 2048`

**증상**: 회의 3단계가 전부 돌고 판정 `✅ 통과`가 뜨는데 **본문이 전부 빈 문자열**.

**원인**: `dev-provider.mjs`의 `nvidiaChat`이 `max_tokens: 2048` 고정. 현재 기본 모델 `openai/gpt-oss-120b`는 **추론형**이라 `reasoning_content`에 먼저 쓴다.

실측 (같은 프롬프트, 같은 키):

| 프롬프트 | finish_reason | reasoning_content | content |
|---|---|---:|---:|
| 짧은 1문장 | `stop` | 231자 | 정상 |
| 실제 회의 과제 | **`length`** | **2,425자** | **잘림** |

`content`가 비면 `runDevTask`가 `"(작업 완료)"`를 반환하고, 그게 그대로 다음 단계 입력이 됩니다. 3단계가 전부 빈 채로 흘러갑니다.

**조치** — `webapp/server/dev-provider.mjs`
```js
const MAX_TOKENS = Number(process.env.VE_DEV_MAX_TOKENS ?? 8192);   // 신설
... max_tokens: MAX_TOKENS,                                          // 2048 → 상수
```

---

## 3. ✅ HTTP 410 — 폴백 모델이 EOL

`runDevTask`의 폴백이 `"qwen/qwen3-next-80b-a3b-instruct"`였는데 NIM 응답:

```
410 Gone — "The model 'qwen/qwen3-next-80b-a3b-instruct' has reached its
            end of life on 2026-07-27T00:00:00Z and is no longer available."
```

`openclaw.json`에 `agents.defaults.model.primary = nvidia/openai/gpt-oss-120b`가 있어 **평소엔 폴백까지 안 갑니다.** 다만 에이전트별 모델을 지정하다 값이 비면 바로 터집니다.

**조치** — 폴백을 `"openai/gpt-oss-120b"`로 교체.

---

## 4. 🔴 MCP 서버 5개 전부 꺼져 있음 → **환각의 구조적 원인**

`config/mcp.json` 실측:

| id | enabled | command |
|---|:--:|---|
| `filesystem` | **false** | `npx -y @modelcontextprotocol/server-filesystem {{KIT}}` |
| `git` | **false** | `npx -y @modelcontextprotocol/server-git --repository {{KIT}}` |
| `unity-coplay` | **false** | `uvx mcp-for-unity` |
| `unity-ankle` | **false** | `node {{UNITY}}/unity-mcp-server/dist/index.js` |
| `unity-hunt` | **false** | `node {{UNITY}}/unity-mcp-advanced/server/index.js` |

`startHub()` 결과: **ready 0개 · 도구 0개.**

> **`review`·`testeng`가 계속 없는 파일을 지어내는 이유가 여기 있었습니다.** 페르소나가 *"도구로 파일을 직접 읽어 검토하라"* 라고 시키는데 **도구가 없습니다.** 모델은 "못 읽었다"고 하는 대신 **그럴듯한 파일명을 만들어냅니다** — `recipes.csv`, `RecipeData.json`, CI 파이프라인, 서버사이드 검증.
>
> 실측 대조: **브리핑을 프롬프트에 직접 붙여 넣자 환각이 거의 사라졌습니다.**
> | | 브리핑 없음 | 브리핑 있음 |
> |---|---|---|
> | 날조한 보스 | 2종 | **0** |
> | 기존 자원을 신규라고 제안 | 1건 | **0** |
> | review 환각 | 4종류 | 1종류(멀티플레이) |

**켤지 말지는 오너 판단입니다** — `filesystem` MCP는 에이전트에게 **쓰기 권한**까지 줍니다.

---

## 5. 🟡 켜도 기획 에이전트는 도구를 못 받습니다

`assignmentsByServer()` 실측 — `filesystem` 배정 대상:

```
uarch, ugp, netcode, techart, edtool, td, review, testeng
```

**`systems`·`balance`·`gameplay`·`uiux`가 없습니다.** `mcp.json`의 각 서버에 `agents` 필드가 `null`이라 하드코딩 기본값(개발 직군)이 적용됩니다.

기획 에이전트에게 **정본 읽기**를 시키려면 `filesystem`의 `agents`에 이들을 추가해야 합니다. (읽기 전용 서버를 따로 두는 게 더 안전해 보입니다 — `{{KIT}}`만 노출하는 filesystem 인스턴스를 `agents: ["systems","balance","gameplay","uiux","scenario"]`로.)

---

## 6. 🟡 제안 — 빈 결과를 `통과`로 판정하지 않게

`runDevMeeting` 마지막 줄:

```js
const verdict = /❌|미흡/.test(test.final) ? "❌ 미흡"
              : /⚠️|조건부/.test(test.final) ? "⚠️ 조건부"
              : "✅ 통과";
```

`test.final`이 `"(작업 완료)"`거나 빈 문자열이어도 **`✅ 통과`**가 됩니다. 이번에 실제로 그렇게 나왔습니다.

```js
const empty = !test.final || test.final.trim() === "(작업 완료)" || test.final.trim().length < 40;
const verdict = empty ? "⚠️ 판정 불가(응답 없음)" : /* 기존 분기 */;
```

**고치지 않았습니다** — 판정 로직은 오너 소관으로 보입니다.

---

## 이번에 제가 실제로 바꾼 것 — **2줄뿐**

`webapp/server/dev-provider.mjs`
1. `max_tokens: 2048` → `MAX_TOKENS`(기본 8192, `VE_DEV_MAX_TOKENS` env)
2. 폴백 모델 `qwen/qwen3-next-80b-a3b-instruct` → `openai/gpt-oss-120b`

**그 외에는 아무것도 안 건드렸습니다.** 서버 재시작·MCP 활성화·노출 모드 변경·판정 로직은 전부 오너 판단으로 남겼습니다.
회의는 **웹앱을 건드리지 않고 in-process로 `runDevTask`를 직접 호출**해 돌렸습니다(같은 페르소나·같은 프로바이더).

---

## 오너가 정할 것 — 3개

1. **403 해법** — ㉠ PC 모드 / **㉡ loopback 동시 바인딩(권장)** / ㉢ 원격 허용
2. **MCP `filesystem`을 켤지** — 켜면 환각이 줄지만 에이전트에게 파일 쓰기 권한이 생깁니다
3. **기획 에이전트에게 정본 읽기 권한을 줄지** — 준다면 읽기 전용 인스턴스를 따로 두는 쪽을 권합니다

---

# 후속 — 2026-08-12 처리 결과

오너 지시: *"난 정본 주고 싶고 mcp 키고 싶긴 한데 첫 번째는 어떻게 해야 할지 모르겠네."* → 2·3은 지시대로 반영, 1은 **네 번째 선택지**를 찾아 노출 설정을 바꾸지 않고 해결했습니다.

| # | 처리 | 근거 |
|---|---|---|
| 1 | ✅ **㉣ 자기 자신의 tailnet IP를 로컬로 인정** | 아래 |
| 2·3 | ✅ 이미 반영돼 있음(확인) | `dev-provider.mjs:49`, `:88` |
| 4 | ✅ `canon`·`filesystem` 켬 (git·Unity는 그대로 off) | `config/mcp.json` |
| 5 | ⚠️ **보고서가 반대였음** — 아래 정정 | 실측 |
| 6 | ✅ 빈 응답 → `⚠️ 판정 불가` | `dev-provider.mjs` |

## 1번 — 노출을 넓히지 않는 네 번째 길 (㉣)

㉠~㉢은 전부 **폰 접속을 잃거나 LAN에 노출**됩니다. 그런데 실측해 보면:

```
PC 브라우저 → http://100.114.32.46:5199
  req.socket.remoteAddress = 100.114.32.46   ← 이 PC 자신의 tailnet IP
폰        → 같은 주소
  req.socket.remoteAddress = 폰의 다른 100.x
```

`isLocalReq`가 loopback에 더해 **이 PC가 가진 100.x 주소들**(`os.networkInterfaces()`, 30초 캐시)을 인정하면 **바인딩을 하나도 바꾸지 않고** PC=허용 / 폰=차단이 정확히 갈립니다. WireGuard가 피어별 주소를 강제하므로 tailnet 안에서 사칭이 불가능합니다. LAN 주소(192.168.x)는 그 보장이 없어 **일부러 제외**했습니다.

**실측** — tailnet 전용 바인딩(`127.0.0.1:5199` = 응답 없음) 상태 그대로:

| 항목 | 이전 | 이후 |
|---|---|---|
| `POST /api/dev-meeting` | **403** | **200** `text/event-stream` |
| `127.0.0.1:5199` | 죽음 | **여전히 죽음**(노출 안 넓혔다는 증거) |

## 5번 정정 — "도구 0개"가 아니라 **전체 허용**이었습니다

보고서는 `assignmentsByServer()`를 근거로 들었지만 그건 **UI 표시용 역맵**입니다. 실제 강제는 `serversForAgent()`가 하고, 그 함수는 *"assignments에 없으면 전체 허용"*이었습니다.

```
실측:  serversForAgent("systems") → null  (= 전체 허용)
```

서버가 전부 disabled였을 땐 결과가 0개라 티가 안 났지만, **`filesystem`을 켜는 순간 기획 직군 전원이 `write_file`·`edit_file`·`move_file`까지 받습니다.** 켜기 전에 배정부터 막아야 했던 겁니다.

**처방**: `assignments._default` 지원(fail-closed) + 21명 전원 명시 배정.

## 2·3번 — 정본은 읽기 전용 서버로 분리

`@modelcontextprotocol/server-filesystem`은 **읽기 전용 모드가 없습니다**(도구 14개 중 `write_file`·`edit_file`·`move_file`·`create_directory` 4개가 쓰기). 그래서 `webapp/server/mcp-canon.mjs`를 새로 만들었습니다 — **도구 3개(`list`·`read`·`grep`), 쓰기 도구 없음.**

- 노출: `GDD.md` · `decisions.json` · `approvals.json` · `project.json` · `kit/**`
- **제외: `*.bak*`** — 프로젝트 폴더에 백업이 10여 개라, 같이 보여주면 v37/v55 같은 낡은 판을 정본으로 인용합니다
- `grep` 0건이면 *"정본에 없습니다. 신규면 신규라고 명시하세요"*로 되돌려줌

**배정**: 기획 13명 = `canon`만 · 개발 8명 = `canon` + `filesystem`(kit/ 한정 쓰기)

| 에이전트 | 이전 | 이후 |
|---|---|---|
| balance·systems·gameplay·uiux·pm 등 13명 | 0개 → (켜면) **17개, 쓰기 포함** | **3개, 전부 읽기** |
| td·review·testeng·uarch 등 8명 | 0개 | **17개** |
| 목록에 없는 새 에이전트 | 전체 허용 | **3개(정본만)** |

## 실전 회의 1회 — 날조 0건

`balance`에게 *"강철이의 HP가 실제로 얼마인지 도구로 확인해서 파일과 행 번호를 대라"* (tailnet 모드, 이전엔 403이라 아예 못 돌리던 상태)

| 에이전트가 주장한 것 | 정본 실제 | |
|---|---|:--|
| HP **2800** | `2800` | ✅ |
| `kit/data/yokai-stats.csv` **8행** | 8행 = `gangcheol,강철이,…,2800,…` | ✅ |
| review: `content-status.csv`가 `수정예정`으로 어긋남 | 832행 `yokai-stats.csv,id,gangcheol,수정예정,v70` | ✅ |
| 존재하지 않는 파일 인용 | — | **0건** |

이전 회의에서 나오던 `recipes.csv`·`RecipeData.json` 류의 날조가 사라졌습니다.

## 6번 — 빈 응답 재현 검증

`VE_DEV_MAX_TOKENS=180`으로 원 증상을 되살렸습니다.

```
3단계 전부 빈 응답
  이전 코드 → ✅ 통과
  현재      → ⚠️ 판정 불가 — 구현·리뷰·검증 단계가 빈 응답
              (finish_reason: stop, length, length)
```

## 추가로 막은 것 — 조용히 틀린 정본을 읽는 경로

MCP 서버는 `startHub()` 시점의 **"가장 최근 수정된 프로젝트"**에 고정됩니다. UI에서 프로젝트를 바꿔도 옛 프로젝트의 정본을 계속 읽고, 에이전트는 그걸 모릅니다. `ensureCurrentProject()`가 작업 시작 전에 확인해 달라졌을 때만 재연결합니다. 확인용으로 `canon__list`가 항상 루트 프로젝트 id를 먼저 출력합니다.

## 추가 — git MCP 활성화 (오너 지시 "uv 설치하고 git mcp도 켜줘")

uv는 **이미 설치돼 있었습니다**(0.11.16, PATH 등록됨). 켜는 과정에서 함정 셋:

| 함정 | 증상 | 처방 |
|---|---|---|
| 원 설정이 없는 패키지 | `npx @modelcontextprotocol/server-git` — npm에 없음 | `uvx mcp-server-git` |
| SDK 2.0 비호환 | `AttributeError: 'Server' object has no attribute 'list_tools'` → 허브엔 `Connection closed`만 | `--with "mcp<2"` (1.29.0) |
| `--repository`가 기본값으로 안 먹음 | 모델이 kit 폴더를 찍고 **"kit은 git 저장소가 아니다, `git init`하라"**는 틀린 결론 | `argsFix`로 `repo_path` 강제 고정 |

**쓰기 도구 5종은 뺐습니다.** 지금 GDD·CSV에 커밋 안 된 정본 수정이 남아 있어, 에이전트가 그걸 임의로 커밋하거나 브랜치를 옮기면 되돌리기 어렵습니다.

| | |
|---|---|
| 노출 7 | `git_status` `git_diff` `git_diff_staged` `git_diff_unstaged` `git_log` `git_show` `git_branch` |
| 🔒 차단 5 | `git_commit` `git_add` `git_reset` `git_create_branch` `git_checkout` |

목록에서 감추기만 하면 모델이 이름을 지어내 호출할 수 있어 **`callTool`에서도 막습니다**(실측: `git__git_commit` → `이 서버에서 차단된 도구입니다`). 배정은 **개발 8명만** — 기획 직군은 정본 3개 그대로입니다.

**실전 확인** — review에게 *"최근 커밋을 확인하고, 새 커밋을 만들어봐라"*:

> 해시 `fbf64a3…` · 제목 `feat(mcp): 정본 읽기 전용 MCP 서버 + MCP 활성화, tailnet 403 해제` · 변경 요약 정확
> *"커밋을 수행할 수 있는 도구가 없어 실제 커밋 생성은 불가능했습니다"*

## 아직 오너 몫으로 남긴 것

- **Unity MCP 3종** — 유니티 에디터가 열려 있어야 해서 그대로 off.
- **설계 회의(`/api/agent` → OpenClaw)는 여전히 MCP를 안 씁니다.** 거기 정본은 다이제스트 주입(`canon.ts`)이 담당합니다. MCP 정본 도구는 **개발 작업·개발 회의** 경로에만 붙습니다.
