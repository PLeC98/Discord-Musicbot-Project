// 글 가운데에 무언가를 끼워 넣는 규칙 — 이모지 고르는 판을 붙인 칸들이 함께 쓴다.
//
// 판을 열면 칸에서 초점이 떠나므로, 부르는 쪽이 떠나기 전 커서 자리를 적어 두었다가 넘겨준다.
// 한 번도 만지지 않은 칸은 적어 둔 것이 없어 글 끝에 붙는다.

/**
 * @param {string} text 지금 글
 * @param {string} piece 끼워 넣을 것
 * @param {{start:number,end:number}|null} at 적어 둔 커서 자리(없으면 글 끝)
 * @param {number} [max] 길이 상한 — 넘기게 되면 넣지 않는다(몰래 잘라내면 더 헷갈린다)
 * @returns {{text:string, caret:number}|null} 넣을 수 없으면 null
 */
export function insertAt(text, piece, at, max) {
  const body = text || "";
  const start = Math.min(at?.start ?? body.length, body.length);
  const end = Math.min(at?.end ?? body.length, body.length);

  const next = body.slice(0, start) + piece + body.slice(end);
  if (max && next.length > max) return null;
  return { text: next, caret: start + piece.length };
}

/** 칸에서 지금 커서 자리를 읽는다. 읽을 수 없으면 null — 그러면 글 끝에 붙는다. */
export function caretOf(el) {
  if (!el || el.selectionStart == null) return null;
  return { start: el.selectionStart, end: el.selectionEnd };
}
