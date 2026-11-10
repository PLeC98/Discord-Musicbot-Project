// 목록, 상세 편집기(자동재생 장르, 상태 문구)의 행 key. 저장, 되돌리기로 받은 값을 다시 행으로 만들 때 지금 행의 key 를 물려준다.
// 새 key 면 선택한 항목의 카드가 다른 카드로 바뀌어 사라졌다 다시 나타나고, 선택도 주소의 이름으로 다시 찾다가 놓친다(composables/list-detail)

type Keyed = { key: number; name: string };

/**
 * 다시 만들 행 이름마다 물려줄 key. 이름이 같은 지금 행 → 없으면 같은 자리의 지금 행(이름을 고쳤다 되돌렸다) → 없으면 fresh().
 * 한 key 는 한 번만 물려준다
 */
function keysFrom(names: string[], before: Keyed[], fresh: () => number): number[] {
  const used = new Set<number>();
  const take = (one: Keyed | undefined) => {
    if (!one || used.has(one.key)) return undefined;
    used.add(one.key);
    return one.key;
  };
  const byName = names.map((name) => take(before.find((one) => !used.has(one.key) && one.name.trim() === name.trim())));
  return byName.map((key, i) => key ?? take(before[i]) ?? fresh());
}

export { keysFrom };
