// 끌어 놓은 자리로 차례를 바꾼다. 대기열 · 설정 편집기의 카드가 같이 쓴다

/** from 번째를 insertAt 틈(0 ~ 길이)으로 옮긴 새 목록. 앞에서 빼면 뒤쪽 자리가 하나씩 당겨진다 */
export function reordered<T>(list: readonly T[], from: number, insertAt: number): T[] {
  const next = [...list];
  const [one] = next.splice(from, 1);
  next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, one);
  return next;
}
