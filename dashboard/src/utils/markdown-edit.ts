import { text as screenText } from "../text/index.ts";
const LINK_TEXT = screenText.fields.linkText;
// 공지 입력칸의 서식 도구: 고른 글을 감싸거나(굵게 등) 고른 줄 앞에 기호를 붙인다(제목 · 목록 등). 이미 있으면 뗀다(켜고 끄기)

export type Edit = { text: string; start: number; end: number };

/** 고른 글을 left · right 로 감싼다. 이미 감싸져 있으면 벗긴다. 고른 글이 없으면 기호 사이에 커서를 둔다 */
export function wrap(text: string, start: number, end: number, left: string, right = left): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (before.endsWith(left) && after.startsWith(right)) {
    return { text: before.slice(0, -left.length) + text.slice(start, end) + after.slice(right.length), start: start - left.length, end: end - left.length };
  }
  const inner = text.slice(start, end);
  if (inner.startsWith(left) && inner.endsWith(right) && inner.length >= left.length + right.length) {
    const bare = inner.slice(left.length, inner.length - right.length);
    return { text: before + bare + after, start, end: start + bare.length };
  }
  return { text: before + left + inner + right + after, start: start + left.length, end: end + left.length };
}

// 줄 앞 기호 중 서로 바뀌는 것(제목 · 작은 글씨는 하나만 붙는다)
const HEADINGS = ["### ", "## ", "# ", "-# "];

/** 고른 줄(커서가 있는 줄)마다 앞에 prefix 를 붙인다. 모든 줄에 이미 있으면 뗀다. numbered 면 1. 2. 3. 으로 */
export function linePrefix(text: string, start: number, end: number, prefix: string, numbered = false): Edit {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toNl = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const to = toNl < 0 ? text.length : toNl;
  const lines = text.slice(from, to).split("\n");
  const has = (l: string) => (numbered ? /^\d+\. /.test(l) : l.startsWith(prefix));
  const all = lines.every(has);
  const heading = HEADINGS.includes(prefix);
  const next = lines.map((l, i) => {
    if (all) return numbered ? l.replace(/^\d+\. /, "") : l.slice(prefix.length);
    const bare = heading ? l.replace(/^(?:#{1,3}|-#) /, "") : l;
    if (has(bare)) return bare;
    return (numbered ? `${i + 1}. ` : prefix) + bare;
  });
  const joined = next.join("\n");
  return { text: text.slice(0, from) + joined + text.slice(to), start: from, end: from + joined.length };
}

/** 코드 블록: 고른 글을 제 줄의 ``` 로 감싼다 */
export function codeBlock(text: string, start: number, end: number): Edit {
  const before = text.slice(0, start);
  const inner = text.slice(start, end);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const open = `${lead}\`\`\`\n`;
  const close = "\n```";
  const tail = text.slice(end);
  const trail = tail === "" || tail.startsWith("\n") ? "" : "\n";
  return { text: before + open + inner + close + trail + tail, start: start + open.length, end: start + open.length + inner.length };
}

/** 링크: 고른 글이 있으면 그 글에, 없으면 "링크 글" 자리에. 주소 칸(https://)을 고른 채로 둔다 */
export function link(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end) || LINK_TEXT;
  const piece = `[${label}](https://)`;
  const urlAt = start + label.length + 3;
  return { text: text.slice(0, start) + piece + text.slice(end), start: urlAt, end: urlAt + "https://".length };
}

/** 시각: 지금 시각을 디스코드 시각 문법으로 넣는다(받는 사람의 시간대로 보인다) */
export function timestampTag(text: string, start: number, end: number, now = Date.now()): Edit {
  const tag = `<t:${Math.floor(now / 1000)}:f>`;
  return { text: text.slice(0, start) + tag + text.slice(end), start: start + tag.length, end: start + tag.length };
}
