// AI 설정의 추가 파라미터(extra) 파서. 요청을 만드는 쪽(autoplay/assist)과 설정 검사(config/schema/ai)가 같은 파서를 쓴다. 화면도 부르는 Node 없는 모듈

import { rule, type RuleProblem } from "./rule-problem.ts";
import { safeKeys, setPath } from "./dot-path.ts";

type Body = Record<string, unknown>;
type Extra = { body: Body; headers: Record<string, string>; drop: string[]; dropHeaders: string[] };
/** 건너뛴 줄. line은 1부터 센 줄 번호(빈 줄, 주석 줄 포함) */
type SkippedLine = { line: number; problem: RuleProblem };

// 파이썬 형식 키워드를 JSON이 읽을 수 있게 바꾼다. 따옴표 안은 건드리지 않는다.
const RELAXED: Array<[string, string]> = [
  ["True", "true"],
  ["False", "false"],
  ["None", "null"],
];
function relaxJson(text: string) {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    // 단어 경계에서만 바꾼다. Nonetype 같은 것을 건드리면 안 된다
    const edge = (c: string | undefined) => !c || !/[A-Za-z0-9_$]/.test(c);
    const hit = RELAXED.find(([word]) => text.startsWith(word, i) && edge(text[i - 1]) && edge(text[i + word.length]));
    if (hit) {
      out += hit[1];
      i += hit[0].length - 1;
    } else out += ch;
  }
  return out;
}

function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    /* 그대로는 JSON이 아니다. 흔한 흠을 고쳐 다시 본다 */
  }
  const relaxed = relaxJson(text);
  if (relaxed !== text) {
    try {
      return { ok: true, value: JSON.parse(relaxed) };
    } catch {
      /* 고쳐도 JSON이 아니다 */
    }
  }
  return { ok: false };
}

/**
 * 추가 파라미터. 한 줄에 하나씩. 서비스마다 이름도 위치도 달라 글로 받는다.
 *
 *   key=value            그대로 (true, false, null, 숫자는 알아서 바꾼다)
 *   key="value"          따옴표로 두르면 숫자처럼 보여도 글자다
 *   a.b.c=value          점으로 안쪽 필드에 넣는다 (thinking.budget_tokens처럼)
 *   key=json::{...}      JSON으로 읽어 넣는다 (객체, 배열)
 *   header::Name=value   본문이 아니라 요청 헤더에 넣는다
 *   key={{none}}         그 값을 아예 안 보낸다 (header::Name={{none}}이면 헤더를 뺀다)
 *   # 주석
 *
 * RisuAI와 같은 입력 형식이다. 파싱에 실패한 줄은 요청에 넣지 않고 skipped로 반환한다(설정 검사가 막지 않는 경고로 표시한다)
 */
function readExtra(text: unknown): { extra: Extra; skipped: SkippedLine[] } {
  const extra: Extra = { body: {}, headers: {}, drop: [], dropHeaders: [] };
  const skipped: SkippedLine[] = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const problem = readExtraLine(line, i + 1, extra);
      if (problem) skipped.push({ line: i + 1, problem });
    });
  return { extra, skipped };
}

// 한 줄(이름=값)을 파싱해 넣는다. 실패하면 그 이유를 반환한다
function readExtraLine(text: string, line: number, out: Extra): RuleProblem | null {
  const at = text.indexOf("=");
  if (at < 1) return rule("ai-extra-no-name", { line });
  const name = text.slice(0, at).trim();
  const value = text.slice(at + 1).trim();
  const header = /^header::/i.test(name) ? name.slice(8).trim() : null;
  if (header === "") return rule("ai-extra-no-name", { line });

  // {{none}}을 header:: 보다 먼저 본다. 안 그러면 헤더에 "{{none}}"을 넣게 된다
  if (value === "{{none}}") {
    if (header !== null) out.dropHeaders.push(header);
    else out.drop.push(name);
    return null;
  }
  if (header !== null) {
    out.headers[header] = value;
    return null;
  }
  if (!safeKeys(name)) return rule("ai-extra-bad-name", { line, name });
  if (value === "") return rule("ai-extra-no-value", { line });

  if (value.startsWith("json::")) {
    const got = readJson(value.slice(6));
    if (!got.ok) return rule("ai-extra-bad-json", { line });
    setPath(out.body, name, got.value);
    return null;
  }
  setPath(out.body, name, scalarOf(value));
  return null;
}

// 값 글 → 값. 따옴표로 싸면 글자, true, false, null, 수는 그 값, 나머지는 글자
function scalarOf(value: string): unknown {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  if (quoted && value.length >= 2) return value.slice(1, -1);
  if (value === "true" || value === "false") return value === "true";
  if (value === "null") return null;
  return Number.isNaN(Number(value)) ? value : Number(value);
}

/** 건너뛸 줄의 문제(막지 않는 경고). 문자열이 아니면 빈 목록(타입은 저장 검사가 본다) */
const extraLineProblems = (text: unknown): RuleProblem[] => (typeof text === "string" ? readExtra(text).skipped.map((one) => one.problem) : []);

export { readExtra, extraLineProblems };
export type { Extra };
