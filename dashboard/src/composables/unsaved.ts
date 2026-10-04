// 저장하지 않은 편집. 설정 편집기가 자기 탭 이름으로 알리고, 운영자 페이지가 탭 표시 · 떠날 때 묻기에 쓴다

import { reactive, watch, onUnmounted, type WatchSource } from "vue";

export const unsaved = reactive(new Set<string>());

/** 편집기가 부른다. dirty 가 참인 동안 name 이 목록에 있다. 편집기가 사라지면 뺀다 */
export function trackUnsaved(name: string, dirty: WatchSource<boolean>): void {
  const stop = watch(dirty, (on) => (on ? unsaved.add(name) : unsaved.delete(name)), { immediate: true });
  onUnmounted(() => {
    stop();
    unsaved.delete(name);
  });
}
