// 열린 판(바텀 시트 등)을 기기 · 브라우저의 뒤로가 닫게 한다. 휴대폰에서 뒤로 손짓을 하면 페이지가 아니라 판이 닫혀야 한다.
// 열 때 같은 주소로 기록을 하나 쌓고(라우터의 상태를 베끼고 판 표시를 단다), 뒤로가 그 기록을 물리면 닫는다.
// 화면 안에서 닫으면(닫기 · 뒤 막 · 끌어 내리기) 쌓은 기록을 무른다. 주소는 바뀌지 않아 라우터는 같은 화면으로 본다

import { onUnmounted, watch, type Ref } from "vue";

const MARK = "sheet";
let made = 0;

/** open: 판이 열려 있는가, close: 판을 닫는다(뒤로를 눌렀을 때 부른다) */
export function useBackDismiss(open: Readonly<Ref<boolean>>, close: () => void) {
  const id = ++made;
  let pushed = false;
  const ours = () => (window.history.state as Record<string, unknown> | null)?.[MARK] === id;

  // 뒤로가 우리 기록을 물렸다: 닫는다. 화면 안에서 닫으며 무른 것이면(pushed 를 먼저 내린다) 아무것도 하지 않는다
  const onPop = () => {
    if (!pushed || ours()) return;
    pushed = false;
    close();
  };
  window.addEventListener("popstate", onPop);

  watch(open, (now) => {
    if (now && !pushed) {
      window.history.pushState({ ...(window.history.state as object | null), [MARK]: id }, "");
      pushed = true;
    } else if (!now && pushed) {
      pushed = false;
      if (ours()) window.history.back();
    }
  });

  // 열린 채 화면이 사라지면 쌓은 기록은 둔다(그 기록으로 뒤로 가도 같은 주소다)
  onUnmounted(() => window.removeEventListener("popstate", onPop));
}
