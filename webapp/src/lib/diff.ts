// 회의 전/후 GDD 비교 — 섹션 단위로 나눠 바뀐 섹션만 줄 단위 diff를 만든다.
// 목적은 정밀한 패치가 아니라 "이번 회의가 내 문서를 어떻게 바꿨나"를 보여주는 것.

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

export interface SectionDiff {
  /** 섹션 헤딩 (예: "## 3. 게임플레이") — 헤딩 밖 서문은 "(서문)" */
  heading: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * "## " 헤딩 기준으로 {heading → body} 분해.
 * 오염된 산출물이 같은 헤딩을 중복 생성하는 실사례가 있어(예: 본문 안에 "## 1. 개요"가
 * 또 들어옴) 중복 헤딩은 "(중복 N)"으로 구분한다 — Map 키 충돌로 diff가 가려지는 것 방지.
 */
function splitSections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  const lines = md.split(/\r?\n/);
  let cur = "(서문)";
  let buf: string[] = [];
  const commit = () => {
    const n = (seen.get(cur) ?? 0) + 1;
    seen.set(cur, n);
    out.set(n === 1 ? cur : `${cur} (중복 ${n})`, buf.join("\n"));
  };
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      commit();
      cur = line.trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  commit();
  return out;
}

/** 줄 단위 LCS diff — 큰 입력은 O(n·m)이 부담이라 상한을 두고, 넘으면 통짜 교체로 표시 */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split(/\r?\n/);
  const B = b.split(/\r?\n/);
  if (A.length * B.length > 250_000) {
    return [...A.map((t) => ({ type: "del" as const, text: t })), ...B.map((t) => ({ type: "add" as const, text: t }))];
  }
  // LCS 길이 테이블
  const n = A.length;
  const m = B.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i] });
      i++;
    } else {
      out.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}

/** 바뀐 섹션만 골라 diff — 같은 섹션은 결과에서 제외 */
export function diffGddSections(before: string, after: string): SectionDiff[] {
  const a = splitSections(before);
  const b = splitSections(after);
  const headings = Array.from(new Set([...a.keys(), ...b.keys()]));
  const out: SectionDiff[] = [];
  for (const h of headings) {
    const av = (a.get(h) ?? "").trim();
    const bv = (b.get(h) ?? "").trim();
    if (av === bv) continue;
    const lines = diffLines(av, bv).filter((l) => !(l.type === "same" && !l.text.trim()));
    out.push({
      heading: h,
      lines,
      added: lines.filter((l) => l.type === "add").length,
      removed: lines.filter((l) => l.type === "del").length,
    });
  }
  return out;
}
