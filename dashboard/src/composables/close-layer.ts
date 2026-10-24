// 열린 판(드롭다운 · 팝업 · 대화상자 · 바텀 시트 · 서랍)을 맨 위 것부터 하나씩 닫는다. 닫는 입력은 Esc 와 기기의 뒤로(안드로이드의 뒤로 손짓 · 버튼)다.
// 브라우저의 뒤로 버튼 · 마우스의 뒤로 버튼은 판과 상관없이 이전 화면으로 간다(기록은 건드리지 않는다).
//
// 둘을 가르는 것은 브라우저의 CloseWatcher 다. 판이 열릴 때 하나 만들고 닫힐 때 없앤다. Esc 와 기기의 뒤로는 맨 위(가장 나중에 만든) 것만 닫는다.
// CloseWatcher 가 없는 브라우저(사파리)는 열린 판을 여기서 쌓아 두고 Esc 로 맨 위 판을 닫는다. 기기의 뒤로는 브라우저의 뒤로와 같다.
//
// 판 안에서 Esc 를 먼저 쓸 곳(검색어 지우기 · 고치던 칸 되돌리기)은 그 keydown 의 preventDefault 를 부른다. 막힌 Esc 로는 판이 닫히지 않는다.
// close 가 닫지 않을 수도 있다(요청을 보내는 중인 대화상자). 그러면 그 판이 그대로 맨 위에 남는다.
// CloseWatcher 는 사용자 입력 없이 만든 것(저절로 뜨는 판, 닫기를 거절해 다시 건 것)을 아래 판과 한 묶음으로 둘 수 있다. 그때는 한 번에 함께 닫힌다

import { nextTick, onScopeDispose, watch, type Ref } from "vue";

interface Watcher {
  onclose: (() => void) | null;
  destroy(): void;
}
const Native = (window as unknown as { CloseWatcher?: new () => Watcher }).CloseWatcher;

/** CloseWatcher 가 없을 때 열린 판의 닫기(나중에 연 것이 뒤) */
const stack: Array<() => void> = [];
if (!Native) {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !stack.length) return;
    event.preventDefault();
    stack[stack.length - 1]();
  });
}

/** open: 판이 열려 있는가(보일 때만 참이어야 한다), close: 판을 닫는다(Esc · 기기의 뒤로로 부른다) */
export function useCloseLayer(open: Readonly<Ref<boolean>>, close: () => void) {
  let stop: (() => void) | null = null;

  function start() {
    if (Native) {
      const watcher = new Native();
      watcher.onclose = () => {
        stop = null;
        close();
        // 닫지 않았다면 CloseWatcher 는 이미 쓰였으니 새로 건다. v-model 로 받은 open 은 다시 그린 뒤에 내려가므로 그때 본다
        void nextTick(() => open.value && !stop && start());
      };
      stop = () => watcher.destroy();
      return;
    }
    // 닫으면 open 이 내려가 아래 watch 가 쌓은 것에서 뺀다. 닫지 않으면 그대로 맨 위에 남는다
    const entry = () => close();
    stack.push(entry);
    stop = () => {
      stop = null;
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
    };
  }

  watch(
    open,
    (now) => {
      if (now && !stop) start();
      else if (!now && stop) {
        stop();
        stop = null;
      }
    },
    { immediate: true },
  );
  // 열린 채 사라지면(화면을 옮기면) 같이 정리한다
  onScopeDispose(() => {
    stop?.();
    stop = null;
  });
}
