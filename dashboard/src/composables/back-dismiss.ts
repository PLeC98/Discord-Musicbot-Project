// 열린 판(바텀 시트 등)을 기기 · 브라우저의 뒤로가 닫게 한다. 휴대폰에서 뒤로 손짓을 하면 페이지가 아니라 판이 닫혀야 한다.
// 열 때 같은 주소로 기록을 하나 쌓고(라우터의 상태를 베끼고 판 표시를 단다), 뒤로가 그 기록을 물리면 닫는다.
// 화면 안에서 닫으면(닫기 · 뒤 막 · 끌어 내리기) 쌓은 기록을 무른다. 주소는 바뀌지 않아 라우터는 같은 화면으로 본다.
// 판 위에 판(시트 위의 드롭다운 등)이 쌓일 수 있다. 둘이 함께 닫히면(드롭다운을 연 채 시트 뒤를 누르면) 위 판이 무른 뒤에 아래 판이 무른다

import { onUnmounted, watch, type Ref } from "vue";

const MARK = "sheet";
let made = 0;
/** 기록을 쌓은 채 열려 있는 판 */
const live = new Set<number>();
/** 무르고 아직 돌아오지 않은 뒤로의 수 */
let backing = 0;
window.addEventListener("popstate", () => (backing = Math.max(0, backing - 1)));
const back = () => {
  backing++;
  window.history.back();
};
const top = () => (window.history.state as Record<string, unknown> | null)?.[MARK];

/** 이 기록 위에 판이 열려 있는가(쌓은 기록이 맨 위에 있다) */
export const layerOpen = () => top() != null;

/** open: 판이 열려 있는가, close: 판을 닫는다(뒤로를 눌렀을 때 부른다), when: 열 때 기록을 쌓을지(열 때 한 번 본다) */
export function useBackDismiss(open: Readonly<Ref<boolean>>, close: () => void, when: () => boolean = () => true) {
  const id = ++made;
  let pushed = false;
  const ours = () => top() === id;

  // 뒤로가 우리 기록을 물렸다: 닫는다. 화면 안에서 닫으며 무른 것이면(pushed 를 먼저 내린다) 아무것도 하지 않는다
  const onPop = () => {
    if (!pushed || ours()) return;
    pushed = false;
    live.delete(id);
    close();
  };
  window.addEventListener("popstate", onPop);

  watch(open, (now) => {
    if (now && !pushed && when()) {
      window.history.pushState({ ...(window.history.state as object | null), [MARK]: id }, "");
      pushed = true;
      live.add(id);
    } else if (!now && pushed) {
      pushed = false;
      live.delete(id);
      if (ours()) back();
      // 위 판의 기록이 아직 맨 위에 있다(함께 닫히는 중): 그 기록이 물러나 우리 기록이 맨 위에 오면 무른다. 우리 기록을 지나치면 그만둔다
      else if (backing > 0 || live.has(top() as number)) {
        const after = () => {
          if (ours()) back();
          else if (layerOpen()) return;
          window.removeEventListener("popstate", after);
        };
        window.addEventListener("popstate", after);
      }
    }
  });

  // 열린 채 화면이 사라지면 쌓은 기록은 둔다(그 기록으로 뒤로 가도 같은 주소다)
  onUnmounted(() => window.removeEventListener("popstate", onPop));
}
