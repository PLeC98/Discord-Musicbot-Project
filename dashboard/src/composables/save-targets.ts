// 운영자 패널의 저장 막대 하나가 저장 · 되돌리는 편집기들. 편집기가 자기를 올려 두고(사라지면 내린다),
// 운영자 패널이 막대를 하나 띄워 고친 편집기를 모두 저장하거나 되돌린다. 탭을 옮겨도 막대는 그대로다.

import { shallowReactive, onUnmounted, type Ref, type ComputedRef } from "vue";

type Flag = Readonly<Ref<boolean>> | ComputedRef<boolean>;

export type SaveTarget = {
  /** 편집기가 있는 운영자 패널 탭(주소 ?tab=). 저장 차례 · 고칠 것이 남은 탭 알림 · 저장에 실패하면 옮겨 갈 탭 */
  tab: string;
  dirty: Flag;
  saving: Flag;
  /** 검사에 걸린 값이 있다(저장을 막는다) */
  blocked?: Flag;
  /** 다시 시작해야 먹는 값을 고쳤다("저장 후 다시 시작"을 더 둔다) */
  restart?: Flag;
  /** 저장. 됐으면 true. restarting 이면 곧 다시 시작한다(다시 시작해야 먹는다는 안내는 뺀다) */
  save: (restarting: boolean) => Promise<boolean>;
  revert: () => void;
};

// 얕게 지켜본다(안의 ref 를 풀지 않는다. 편집기마다 제 ref 를 그대로 읽는다)
export const saveTargets = shallowReactive(new Set<SaveTarget>());

/** 올려 둔다. 돌려준 것을 부르면 내린다 */
export function addSaveTarget(target: SaveTarget): () => void {
  saveTargets.add(target);
  return () => saveTargets.delete(target);
}

/** 편집기의 setup 에서 부른다. 편집기가 사라지면 내린다 */
export function useSaveTarget(target: SaveTarget): void {
  onUnmounted(addSaveTarget(target));
}

/**
 * 고친 편집기를 order(탭 차례)대로 하나씩 저장한다. 하나가 실패하면 거기서 멈추고 그 편집기를 돌려준다(그 탭에 문제가 그려진다).
 * 다 됐으면 null
 */
export async function saveAll(order: readonly string[], restarting = false): Promise<SaveTarget | null> {
  const rank = (one: SaveTarget) => (order.includes(one.tab) ? order.indexOf(one.tab) : order.length);
  const dirty = [...saveTargets].filter((one) => one.dirty.value).sort((a, b) => rank(a) - rank(b));
  for (const one of dirty) if (!(await one.save(restarting))) return one;
  return null;
}

export function revertAll(): void {
  for (const one of saveTargets) if (one.dirty.value) one.revert();
}
