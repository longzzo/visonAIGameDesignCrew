// NVIDIA NIM 이미지 생성 제공자 + 콘텐츠 라우팅 (v2.4)
//
// 정책: 로컬 SD = 최종 목표(규제 게이트 없음, 무제한). NVIDIA = GPU 없이 쓰는 과도기 제공자이나
//       콘텐츠 정책 필터가 있어 유혈·무기·성인·특정 IP 등 게임 아트에 흔한 소재를 거부한다.
//       → '자동' 라우팅에서 규제 소지 있는 요청은 로컬로, 안전한 요청만 NVIDIA로 보낸다.
//       NVIDIA가 정책상 거부하면(PolicyRefusal) 호출부에서 로컬로 폴백한다.
//
// 키는 LLM과 동일하게 ~/.openclaw/openclaw.json 의 models.providers.nvidia.apiKey 를 재사용.
// 이미지 엔드포인트는 LLM(integrate.api.nvidia.com)과 달리 ai.api.nvidia.com/v1/genai/{model}.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OPENCLAW_CFG = path.join(os.homedir(), ".openclaw", "openclaw.json");

function readKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CFG, "utf-8"));
    const k = cfg?.models?.providers?.nvidia?.apiKey;
    if (!k || String(k).includes("{{")) return "";
    return String(k);
  } catch {
    return "";
  }
}

export function nvidiaAvailable() {
  return !!readKey();
}

/**
 * 규제 소지 판정 — 클라우드 콘텐츠 필터가 거부할 만한 소재(게임 아트엔 흔하다).
 * 요청(한국어)과 SD 프롬프트(영어)를 함께 훑는다. 오탐이 있어도 안전한 쪽(로컬)으로 보내는 게 목적.
 */
const SENSITIVE = [
  // 폭력·유혈·고어 (KO)
  "유혈", "피가", "혈흔", "고어", "시체", "주검", "잔혹", "잔인", "폭력", "살해", "살인", "고문", "참수", "부상", "상처", "해골", "좀비", "악마", "괴물", "처형",
  // 무기·전투 (KO)
  "무기", "총", "총기", "권총", "소총", "칼", "단검", "검", "도끼", "전투", "학살",
  // 성인·선정 (KO)
  "성인", "선정", "노출", "섹시", "누드", "나체", "속옷", "야한", "음란",
  // 기타 규제 (KO)
  "마약", "담배", "흡연", "음주",
  // EN
  "blood", "bloody", "gore", "gory", "corpse", "dead body", "brutal", "brutality", "violence", "violent",
  "kill", "killing", "murder", "torture", "behead", "decapitat", "wound", "injury", "guts", "skull",
  "zombie", "demon", "monster", "execution", "weapon", "gun", "firearm", "pistol", "rifle", "knife",
  "dagger", "sword", "blade", "axe", "combat", "massacre",
  "nsfw", "nude", "naked", "topless", "sexy", "lingerie", "suggestive", "erotic", "provocative",
  "drug", "cigarette", "smoking",
];
export function classifySensitive(...texts) {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return SENSITIVE.some((w) => hay.includes(w));
}

// 모델·엔드포인트·요청 스키마는 env로 교체 가능 (NVIDIA 카탈로그/계정 권한이 수시로 바뀌므로).
//  · VE_NVIDIA_IMAGE_URL   : 전체 invoke URL (build.nvidia.com 모델 페이지의 예제 URL을 그대로)
//  · VE_NVIDIA_IMAGE_MODEL : URL 미지정 시 ai.api.nvidia.com/v1/genai/<model> 로 조립
//  · VE_NVIDIA_IMAGE_SCHEMA: "sd3"(prompt 기반, 기본) | "stability"(text_prompts) | "openai"(model+prompt)
const IMG_MODEL = process.env.VE_NVIDIA_IMAGE_MODEL || "stabilityai/stable-diffusion-3_5-large";
const IMG_URL = process.env.VE_NVIDIA_IMAGE_URL || `https://ai.api.nvidia.com/v1/genai/${IMG_MODEL}`;
const IMG_SCHEMA = (process.env.VE_NVIDIA_IMAGE_SCHEMA || "sd3").toLowerCase();

/** 콘텐츠 정책 거부 — 호출부가 로컬 폴백을 판단하도록 구분 */
export class PolicyRefusal extends Error {
  constructor(msg) {
    super(msg);
    this.name = "PolicyRefusal";
  }
}

function buildBody(prompt, negative) {
  const seed = Math.floor(Math.random() * 4294967295);
  if (IMG_SCHEMA === "stability") {
    return {
      text_prompts: [{ text: prompt, weight: 1 }, ...(negative ? [{ text: negative, weight: -1 }] : [])],
      cfg_scale: 5,
      sampler: "K_DPM_2_ANCESTRAL",
      seed,
      steps: 25,
    };
  }
  if (IMG_SCHEMA === "openai") {
    return { model: IMG_MODEL, prompt, size: "1024x1024", n: 1, response_format: "b64_json" };
  }
  // 기본 sd3/flux 계열 — prompt 기반
  return {
    prompt,
    ...(negative ? { negative_prompt: negative } : {}),
    mode: "base",
    cfg_scale: 4.5,
    aspect_ratio: "1:1",
    seed,
    steps: 30,
  };
}

/** NVIDIA 이미지 생성 → base64 PNG. 정책 거부는 PolicyRefusal, 계정 권한/그 외 오류는 Error로 던진다. */
export async function generateNvidiaImage(prompt, negative, { signal } = {}) {
  const key = readKey();
  if (!key) throw new Error("NVIDIA 키가 없습니다 (사이드바 🔑로 등록)");
  const r = await fetch(IMG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "application/json" },
    body: JSON.stringify(buildBody(prompt, negative)),
    signal,
  });
  const txt = await r.text();
  if (!r.ok) {
    // 계정에 이미지 모델 함수 권한이 없음 → 명확히 안내 (로컬로 폴백하되 사유를 남긴다)
    if (/not found for account|function '[^']+': not found/i.test(txt)) {
      throw new Error(
        `NVIDIA 계정에 이미지 모델 '${IMG_MODEL}' 권한이 없습니다 — build.nvidia.com에서 이미지 모델을 활성화하거나 VE_NVIDIA_IMAGE_URL로 사용 가능한 모델을 지정하세요.`
      );
    }
    // 콘텐츠 정책/모더레이션 → 로컬 폴백 신호
    if (r.status === 400 || r.status === 422 || /content|policy|moderat|safety|filter|nsfw|blocked|prohibited/i.test(txt)) {
      throw new PolicyRefusal(`NVIDIA 정책 거부 (${r.status})`);
    }
    throw new Error(`NVIDIA ${r.status}: ${txt.slice(0, 200)}`);
  }
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error("NVIDIA 응답 파싱 실패");
  }
  // 응답 스키마 편차 흡수: artifacts[].base64(Stability) / data[].b64_json(OpenAI) / image / b64_json / images[0]
  const art = j?.artifacts?.[0];
  if (art?.finishReason && /FILTER|CONTENT|BLOCK/i.test(String(art.finishReason))) {
    throw new PolicyRefusal("NVIDIA 콘텐츠 필터에 걸렸습니다");
  }
  let b64 = art?.base64 || j?.data?.[0]?.b64_json || j?.image || j?.b64_json || j?.images?.[0];
  if (typeof b64 === "string" && b64.startsWith("data:")) b64 = b64.split(",")[1];
  if (!b64 || typeof b64 !== "string") throw new Error("NVIDIA가 이미지를 반환하지 않았습니다");
  return b64;
}
