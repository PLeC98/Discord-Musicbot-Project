// 저장하지 않은 편집. 설정 편집기가 자기 탭 이름으로 알리고, 운영자 페이지가 탭 표시 · 떠날 때 묻기에 쓴다.
// 한 탭에 편집기가 여럿이면 "탭:편집기" 로 알린다(하나가 저장해도 다른 편집기의 표시가 지워지지 않게)

import { reactive, watch, onUnmounted, type WatchSource } from "vue";

export const unsaved = reactive(new Set<string>());

/** 그 탭에 저장하지 않은 편집이 있는가 */
export const unsavedIn = (tab: string) => [...unsaved].some((name) => name === tab || name.startsWith(`${tab}:`));

/** 편집기가 부른다. dirty 가 참인 동안 name 이 목록에 있다. 편집기가 사라지면 뺀다 */
export function trackUnsaved(name: string, dirty: WatchSource<boolean>): void {
  const stop = watch(dirty, (on) => (on ? unsaved.add(name) : unsaved.delete(name)), { immediate: true });
  onUnmounted(() => {
    stop();
    unsaved.delete(name);
  });
}
