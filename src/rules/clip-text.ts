// 디스코드 글자 상한(선택지 이름, 메뉴 항목 100자 등)에 맞춰 자르기. 이모지, 결합 문자가 반으로 갈리지 않게 글자 묶음 단위로 자르고,
// 길이는 UTF-16 단위로 잰다(코드 포인트로 세는 쪽보다 길게 나와 어느 쪽으로 세든 넘지 않는다)

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
const ELLIPSIS = "…";

/** max 를 넘으면 글자 묶음 단위로 잘라 끝에 … 를 붙인다 */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (out.length + segment.length + ELLIPSIS.length > max) break;
    out += segment;
  }
  return out + ELLIPSIS;
}

/** 글자 묶음 수(사람이 보는 글자 수) */
function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of GRAPHEMES.segment(text)) count++;
  return count;
}

export { clipText, graphemeLength };
