// 후보 줄 형식 · 프롬프트의 자리표시자. RisuAI 의 CBS 틀을 따르되 필요한 것만 둔다. 봇(autoplay/assist)과 대시보드(미리보기 · 검사)가 같이 부른다.
//
//   {{이름}} · {{이름::인자}}                       값으로 바뀐다. 모르는 이름은 그대로 둔다(오타를 조용히 지우면 왜 사라졌는지 모른다)
//   {{#if-exist 값}} … {{:else}} … {{/}}          값이 비어 있지 않으면 앞, 비면 {{:else}} 뒤(없으면 아무것도). 닫기는 {{/if-exist}} 도. 겹쳐 쓸 수 있다
//
// 참 · 거짓을 가르는 if 는 두지 않는다. 값이 모두 글자(번호 · 장르 · 제목 · 길이)라 "있나 없나"만 가린다. 블록 안 공백은 그대로 둔다(한 줄 형식이라).
// 검사는 문제마다 글자 자리(at, 0부터)를 함께 돌려준다(화면이 그 자리를 짚는다).

type Problem = { at: number; message: string };

type Node = { kind: "text"; text: string } | { kind: "mark"; name: string; arg: string | null; raw: string; at: number } | { kind: "exist"; test: Node[]; then: Node[]; otherwise: Node[]; at: number };

/** 이름 → 값. 인자({{이름::인자}})가 없으면 null */
type Values = Record<string, (arg: string | null) => string>;

/** 이름마다 인자를 받는지 */
type Names = Record<string, { arg: boolean }>;

/** 후보 한 줄의 이름 */
const LINE_NAMES: Names = { index: { arg: false }, genre: { arg: false }, title: { arg: false }, duration: { arg: true } };
/** 프롬프트 섹션의 이름(목록 자리 · 장르는 한 요청에 하나라 프롬프트에서도 쓴다) */
const PROMPT_NAMES: Names = { list: { arg: false }, genre: { arg: false } };

/** 옛 한글 이름 → 새 이름(남아 있으면 검사가 알린다) */
const GONE_NAMES: Record<string, string> = {
  번호: "{{index}}",
  장르: "{{genre}}",
  제목: "{{title}}",
  길이분: "{{duration::m}}",
  길이초: "{{duration::s}}",
  목록: "{{list}}",
};

const OPEN = "{{";
const CLOSE = "}}";
const EXIST = "#if-exist";

/** at 에서 시작한 {{ 의 짝 }} 자리(겹친 {{ }} 를 센다). 없으면 -1 */
function closingOf(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length - 1; i++) {
    if (text.startsWith(OPEN, i)) {
      depth += 1;
      i += 1;
    } else if (text.startsWith(CLOSE, i)) {
      depth -= 1;
      if (!depth) return i;
      i += 1;
    }
  }
  return -1;
}

type Frame = { node: Extract<Node, { kind: "exist" }>; inElse: boolean };

/** 글을 읽어 마디로. offset: 이 글이 원래 글의 어디서 시작하나(겹친 값의 문제 자리를 원래 글 기준으로) */
function parseAt(text: string, names: Names, offset: number, problems: Problem[]): Node[] {
  const root: Node[] = [];
  const stack: Frame[] = [];
  const here = () => (stack.length ? (stack[stack.length - 1].inElse ? stack[stack.length - 1].node.otherwise : stack[stack.length - 1].node.then) : root);
  const pushText = (t: string) => {
    if (!t) return;
    const list = here();
    const last = list[list.length - 1];
    if (last?.kind === "text") last.text += t;
    else list.push({ kind: "text", text: t });
  };

  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(OPEN, i);
    if (open < 0) {
      pushText(text.slice(i));
      break;
    }
    pushText(text.slice(i, open));
    const close = closingOf(text, open);
    if (close < 0) {
      problems.push({ at: offset + open, message: "{{ 를 닫는 }} 가 없습니다." });
      pushText(text.slice(open));
      break;
    }
    const inner = text.slice(open + 2, close);
    const at = offset + open;
    const raw = text.slice(open, close + 2);
    tag(inner, raw, at, open + 2);
    i = close + 2;
  }
  for (const frame of stack) problems.push({ at: frame.node.at, message: `${EXIST} 블록을 닫는 {{/}} 가 없습니다.` });
  return root;

  // 태그 하나. 블록 여닫기 · 그 밖은 이름
  function tag(inner: string, raw: string, at: number, innerStart: number) {
    const word = inner.trim();
    if (word === EXIST || word.startsWith(`${EXIST} `)) return openExist(inner, at, innerStart);
    if (word === ":else") return elseOf(at);
    if (word === "/" || word === `/${EXIST.slice(1)}`) {
      if (!stack.pop()) problems.push({ at, message: "닫을 블록이 없는데 {{/}} 가 있습니다." });
      return;
    }
    if (/^[#/:]/.test(word)) {
      problems.push({ at, message: `모르는 블록 ${raw}. 블록은 {{${EXIST} 값}} … {{:else}} … {{/}} 하나입니다.` });
      return pushText(raw);
    }
    mark(word, raw, at);
  }

  function openExist(inner: string, at: number, innerStart: number) {
    const from = inner.indexOf(EXIST) + EXIST.length;
    const testText = inner.slice(from);
    if (!testText.trim()) problems.push({ at, message: `${EXIST} 뒤에 볼 값을 적어야 합니다. 예: {{${EXIST} {{duration}}}}` });
    const node: Extract<Node, { kind: "exist" }> = { kind: "exist", test: parseAt(testText, names, offset + innerStart + from, problems), then: [], otherwise: [], at };
    here().push(node);
    stack.push({ node, inElse: false });
  }

  function elseOf(at: number) {
    const frame = stack[stack.length - 1];
    if (!frame) problems.push({ at, message: `{{:else}} 는 ${EXIST} 블록 안에만 쓸 수 있습니다.` });
    else if (frame.inElse) problems.push({ at, message: "{{:else}} 가 한 블록에 둘입니다." });
    else frame.inElse = true;
  }

  function mark(word: string, raw: string, at: number) {
    const cut = word.indexOf("::");
    const name = (cut < 0 ? word : word.slice(0, cut)).trim();
    const arg = cut < 0 ? null : word.slice(cut + 2);
    const spec = names[name];
    const now = GONE_NAMES[name];
    const known = Object.keys(names)
      .map((n) => `{{${n}}}`)
      .join(" · ");
    if (!spec) problems.push({ at, message: now ? `{{${name}}} 은 이제 ${now} 입니다.` : `모르는 이름 ${raw}. 쓸 수 있는 것: ${known}` });
    else if (arg !== null && !spec.arg) problems.push({ at, message: `{{${name}}} 은 :: 뒤의 값을 받지 않습니다.` });
    here().push({ kind: "mark", name, arg, raw, at });
  }
}

/** 글을 읽는다. 문제는 글자 자리(0부터)와 함께 */
function parseFormat(text: string, names: Names): { nodes: Node[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const nodes = parseAt(text, names, 0, problems);
  return { nodes, problems: problems.sort((a, b) => a.at - b.at) };
}

/** 마디를 값으로 채운다. 모르는 이름은 적힌 그대로 */
function renderNodes(nodes: Node[], values: Values): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      if (node.kind === "mark") return values[node.name] ? values[node.name](node.arg) : node.raw;
      return renderNodes(node.test, values).trim() ? renderNodes(node.then, values) : renderNodes(node.otherwise, values);
    })
    .join("");
}

/** 그 이름이 어딘가(블록 안 포함)에 있는가 */
function usesName(nodes: Node[], name: string): boolean {
  return nodes.some((node) => (node.kind === "mark" ? node.name === name : node.kind === "exist" ? usesName(node.test, name) || usesName(node.then, name) || usesName(node.otherwise, name) : false));
}

/**
 * 길이(초)를 형식대로. 모르면(0 이하 · 수가 아님) 빈 글. 형식 글자: h 시간 · m 전체 분 · mm 남은 분 두 자리 · s 전체 초 · ss 남은 초 두 자리,
 * 그 밖의 글자는 그대로. 형식이 없으면 m:ss(예: 3:05)
 */
function formatDuration(seconds: number | null | undefined, format: string | null): string {
  const sec = Math.round(Number(seconds));
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  const parts: Record<string, string> = { h: String(Math.floor(sec / 3600)), m: String(Math.floor(sec / 60)), mm: two(Math.floor(sec / 60) % 60), s: String(sec), ss: two(sec % 60) };
  return (format ?? "m:ss").replace(/mm|ss|h|m|s/g, (part) => parts[part]);
}

export { LINE_NAMES, PROMPT_NAMES, GONE_NAMES, parseFormat, renderNodes, usesName, formatDuration };
export type { Problem, Node, Values, Names };
