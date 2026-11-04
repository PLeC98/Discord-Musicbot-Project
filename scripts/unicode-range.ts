// CSS @font-face 의 unicode-range 글과 코드포인트 목록을 오간다. 글꼴을 만드는 스크립트(build-*-font)가 함께 쓴다

/** "U+AC00-AC0F, U+00A0" → 코드포인트들 */
function codepointsOf(range: string): number[] {
  return range.split(",").flatMap((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, "").split("-");
    const start = parseInt(from, 16);
    const end = parseInt(to, 16);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}

/** 코드포인트들 → "U+0020-007E, U+00A0" (이어지는 것은 묶는다) */
function rangeOf(cps: Iterable<number>): string {
  const sorted = [...new Set(cps)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
    parts.push(i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`);
    i = j;
  }
  return parts.join(", ");
}

export { codepointsOf, rangeOf };
