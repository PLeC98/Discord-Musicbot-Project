// 디스코드 글자 상한(선택지 이름, 메뉴 항목 100자 등)에 맞춰 자르기와 화면 폭으로 자르기. 이모지, 결합 문자가 반으로 갈리지 않게 글자 묶음 단위로 자른다.
// 글자 상한은 UTF-16 단위로 잰다(코드 포인트로 세는 쪽보다 길게 나와 어느 쪽으로 세든 넘지 않는다).
// 화면 폭은 한글, 한자, 가나, 전각 기호, 이모지를 2, 나머지를 1로 센다(디스코드 글꼴에서 한글 한 자가 영문 소문자 두 자 폭 안팎이다)

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
const ELLIPSIS = "…";
/** 넓은 글자: 한글, 한자, 가나, CJK 기호와 전각 글자, 이모지 */
const WIDE = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6\p{Extended_Pictographic}]/u;

/** max를 넘으면 글자 묶음 단위로 잘라 끝에 …를 붙인다 */
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

/** 글자 묶음 하나의 화면 폭 */
const segmentWidth = (segment: string) => (WIDE.test(segment) ? 2 : 1);

/** 화면 폭 */
function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of GRAPHEMES.segment(text)) width += segmentWidth(segment);
  return width;
}

/** 화면 폭이 width 이하면 그대로, 넘으면 폭 width - 2까지 남기고 …를 붙인다(한글로 꽉 찬 줄이면 마지막 한 자 자리에 …) */
function clipWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    const next = used + segmentWidth(segment);
    if (next > width - 2) break;
    out += segment;
    used = next;
  }
  return out + ELLIPSIS;
}

export { clipText, clipWidth, displayWidth, graphemeLength, ELLIPSIS, GRAPHEMES };
