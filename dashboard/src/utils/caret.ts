// 글 가운데에 무언가를 끼워 넣는 규칙. 이모지 선택 판을 붙인 입력란들이 함께 쓴다.
//
// 판을 열면 입력란에서 포커스가 떠나므로, 부르는 쪽이 떠나기 전 커서 위치를 적어 두었다가 넘겨준다.
// 한 번도 만지지 않은 입력란은 적어 둔 것이 없어 글 끝에 붙는다.

/** 커서 위치(선택한 범위면 start ~ end) */
type Caret = { start: number; end: number };

/**
 * text: 지금 글 · piece: 끼워 넣을 것 · at: 적어 둔 커서 위치(없으면 글 끝)
 * max: 길이 상한. 넘기게 되면 넣지 않는다(몰래 잘라내면 더 헷갈린다). 넣을 수 없으면 null
 */
export function insertAt(text: string | null | undefined, piece: string, at: Caret | null | undefined, max?: number): { text: string; caret: number } | null {
  const body = text || "";
  const start = Math.min(at?.start ?? body.length, body.length);
  const end = Math.min(at?.end ?? body.length, body.length);

  const next = body.slice(0, start) + piece + body.slice(end);
  if (max && next.length > max) return null;
  return { text: next, caret: start + piece.length };
}

/** 입력란에서 지금 커서 위치를 읽는다. 읽을 수 없으면 null. 그러면 글 끝에 붙는다. */
export function caretOf(el: HTMLInputElement | HTMLTextAreaElement | null | undefined): Caret | null {
  if (!el || el.selectionStart == null || el.selectionEnd == null) return null;
  return { start: el.selectionStart, end: el.selectionEnd };
}

export type { Caret };
