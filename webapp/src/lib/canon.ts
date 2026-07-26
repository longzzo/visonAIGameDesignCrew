/**
 * 정본 대조 (Canon Keeper) — "잘 썼는가"가 아니라 "사실인가"를 본다.
 *
 * 오너 실측 2026-07-26 (VE 실사용 진단 A-1):
 *   · 존재하지 않는 키 `wall_health=100`을 "정본 v31"이라 인용한 산출물 → QA 일관성 **10/10**
 *   · 실재하는 정본 `seal_window_ry=12` → QA "정본과 충돌"이라며 **5.5/10 반려**
 * 원인은 QA가 정본 파일을 열지 않고 산출물의 내적 완성도만 보기 때문이다.
 * 그래서 **채점 이전에** 돌아가는 결정론적 게이트를 둔다. LLM이 아니라 파일이 판정한다.
 *
 * 정본의 식별자는 전부 snake_case로 통일돼 있다(globals.csv의 key, 각 CSV의 id 열).
 * 예: heat_stage_period · insul_clay_wall_hp · seal_window_ry · club_shard
 */

export interface CanonHit {
  file: string;
  line: number;
  text: string;
}
export interface CanonResult {
  key: string;
  found: boolean;
  hits: CanonHit[];
  /** 못 찾았을 때 편집거리가 가장 가까운 실재 키 — 오탈자와 날조를 구분해준다 */
  nearest: string | null;
}
export interface CanonCheck {
  /** 정본(kit 데이터)이 존재하는 프로젝트인가 — 없으면 게이트를 걸지 않는다 */
  hasData: boolean;
  verified: CanonResult[];
  /** 정본을 인용하는 문맥에서 등장했는데 실재하지 않는 키 — 날조 */
  fabricated: CanonResult[];
  /** 실재하지 않지만 신규 제안으로 보이는 키 — 반려하지 않고 QA에게만 알린다 */
  proposed: CanonResult[];
}

/**
 * snake_case가 아닌 흔한 오탐을 걸러낸다.
 * (프롬프트·마크다운·코드 관용어가 산출물에 섞여 들어오는 경우)
 */
const NOISE = new Set([
  "name_ko", "max_stack", "mvp_scope", "content_type", "utf_8", "text_plain",
  "e_g", "i_e", "et_al", "no_op", "to_do", "read_me",
]);

/** 산출물에서 정본 식별자 후보를 뽑는다 */
export function extractCanonKeys(text: string): string[] {
  // 코드펜스 안의 예제 코드는 정본 인용이 아닐 확률이 높아 제외
  const body = text.replace(/```[\s\S]*?```/g, " ");
  const out = new Set<string>();
  for (const m of body.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    const k = m[0];
    if (k.length < 5 || k.length > 48) continue;
    if (NOISE.has(k)) continue;
    out.add(k);
  }
  return [...out].slice(0, 60);
}

/**
 * 이 키가 "정본이다"라고 주장하는 문맥에서 쓰였는가.
 *
 * 신규 제안("새 키 xxx_yyy를 추가하자")까지 반려하면 설계가 마비된다.
 * 반려 대상은 **없는 것을 있다고 말한 경우**뿐이다.
 */
export function isCitedAsCanon(text: string, key: string): boolean {
  const lines = text.split(/\r?\n/);
  const claim = /정본|기존|현재|확정|globals|\.csv|GDD|v\d{2}|이미|원래/;
  const propose = /신규|새로|새 |추가|제안|도입|만들|신설|권장|바꾸|변경안/;
  for (const ln of lines) {
    if (!ln.includes(key)) continue;
    if (propose.test(ln)) continue; // 제안 문맥이면 날조로 보지 않는다
    // ① 정본 근거를 대는 문장  ② key=값 / key: 값 형태의 사실 단정
    if (claim.test(ln)) return true;
    if (new RegExp(`${key}\\s*[=:]\\s*-?\\d`).test(ln)) return true;
  }
  return false;
}

async function canonFetch(path: string): Promise<any> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`canon ${r.status}`);
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error ?? "canon error");
  return j;
}

/** 정본 존재 여부 — kit 데이터가 없는 프로젝트에 게이트를 걸면 전부 날조가 된다 */
export async function canonStatus(project: string): Promise<{ hasData: boolean; files: string[] }> {
  try {
    const j = await canonFetch(`/api/canon/status?project=${encodeURIComponent(project)}`);
    return { hasData: !!j.hasData, files: j.files ?? [] };
  } catch {
    return { hasData: false, files: [] };
  }
}

/** 정본 다이제스트 — 회의 컨텍스트에 넣을 "실제 파일에서 읽은 값" */
export async function canonDigest(project: string): Promise<string> {
  try {
    const j = await canonFetch(`/api/canon/digest?project=${encodeURIComponent(project)}`);
    return typeof j.text === "string" ? j.text : "";
  } catch {
    return "";
  }
}

/** 산출물 1건을 정본과 대조한다 */
export async function checkCanon(project: string, draft: string): Promise<CanonCheck | null> {
  const keys = extractCanonKeys(draft);
  const empty: CanonCheck = { hasData: false, verified: [], fabricated: [], proposed: [] };
  if (keys.length === 0) return null;
  let status: { hasData: boolean };
  let results: CanonResult[];
  try {
    status = await canonStatus(project);
    if (!status.hasData) return { ...empty };
    const j = await canonFetch(
      `/api/canon/grep?project=${encodeURIComponent(project)}&keys=${encodeURIComponent(keys.join(","))}`
    );
    results = (j.results ?? []) as CanonResult[];
  } catch {
    return null; // 조회 실패는 게이트를 통과시킨다 — 도구 장애로 회의를 막지 않는다
  }
  const check: CanonCheck = { hasData: true, verified: [], fabricated: [], proposed: [] };
  for (const r of results) {
    if (r.found) check.verified.push(r);
    else if (isCitedAsCanon(draft, r.key)) check.fabricated.push(r);
    else check.proposed.push(r);
  }
  return check;
}

/** 확인된 정본 값 — QA·작성자 프롬프트에 넣어 "진짜 정본을 반려하는" 반대 오류를 막는다 */
export function canonFactBlock(check: CanonCheck | null): string {
  if (!check || check.verified.length === 0) return "";
  const lines = check.verified
    .slice(0, 25)
    .map((r) => `- \`${r.key}\` → ${r.hits[0].file}:${r.hits[0].line} · ${r.hits[0].text}`);
  return [
    `[정본 대조 결과 — 실제 파일에서 확인된 값]`,
    `아래는 도구가 파일을 직접 읽어 확인한 사실이다. **이 값들과 일치하는 서술을 "정본과 충돌"이라고 반려하지 마라.**`,
    ...lines,
  ].join("\n");
}

/** 날조 반려 사유 — 작성자에게 돌려보낼 지적문 */
export function canonRejectNotes(check: CanonCheck): string {
  return check.fabricated
    .slice(0, 8)
    .map((r) => `- \`${r.key}\` — 정본 파일 어디에도 없다.${r.nearest ? ` 혹시 \`${r.nearest}\`를 말한 것인가?` : " 실제 값을 확인하지 않고 쓴 것으로 보인다."}`)
    .join("\n");
}

/** 정본 반려 후 재작성 지시 */
export function canonRevisePrompt(sectionTitle: string, check: CanonCheck, digest: string): string {
  return [
    `🚫 **정본 대조 반려** — 네 "${sectionTitle}" 산출물이 **존재하지 않는 정본 키를 사실인 것처럼 인용**했다.`,
    `점수를 매기기 전에 먼저 사실을 고쳐야 한다.`,
    ``,
    `[실재하지 않는 키]`,
    canonRejectNotes(check),
    ``,
    digest ? `[실제 정본 데이터 — 이 안에 있는 키만 인용할 수 있다]\n${digest.slice(0, 6000)}\n` : ``,
    `규칙:`,
    `1. 위 키들을 **실재하는 키로 교체**하거나, 인용이 아니라 **신규 제안**임을 문장에 명시해라("신규 제안: …").`,
    `2. 정본에 있는 값을 임의로 바꾸지 마라. 바꿔야 한다면 "변경 제안"이라고 적어라.`,
    `3. 확인하지 않은 수치는 쓰지 마라. 모르면 "정본 미확인"이라고 적어라.`,
    ``,
    `수정된 최종본 전체만 출력해라. 순수 마크다운, 도구 호출 금지, 사족 금지.`,
  ]
    .filter(Boolean)
    .join("\n");
}
