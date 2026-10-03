// 입력칸 아래에 붙여 띄우는 패널의 자리를 잡는다. 드롭다운 목록이 쓴다.
//
// 그냥 absolute 로 두면 카드 안에 갇힌다. BaseCard 에 backdrop-blur 가 걸려 있어서
// 카드가 제 쌓임 맥락을 만들고, 그 안의 z-index 는 아무리 올려도 카드 바깥 형제를
// 못 넘는다. 아래 고정 재생바에도 깔린다. 그래서 body 로 내보내고(Teleport) 좌표를
// 직접 준다. fixed 만으로는 안 된다. backdrop-filter 가 걸린 조상은 fixed 의 기준이
// 되어 버리기 때문이다.
//
// 자리를 잡고 나면 세 가지를 더 본다.
//   아래가 좁으면 위로 뒤집는다. 아래 재생바가 가리는 만큼은 자리가 아니다.
//   스크롤과 창 크기 변화를 따라간다. 내부 스크롤 칸도 잡으려면 캡처로 들어야 한다.
//   칸 자체가 커지면(칩이 늘면) 다시 잰다.
import { ref, nextTick, watch, onBeforeUnmount } from "vue";

// 재생바가 가리는 높이. --player 는 App.vue 가 트리에 얹으므로 칸에서 물려받아 읽는다.
function coveredBottom(el) {
  const raw = getComputedStyle(el).getPropertyValue("--player").trim();
  const n = parseFloat(raw);
  if (!n) return 0;
  return raw.endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

/**
 * @param {object}   o
 * @param {import("vue").Ref} o.root   칸을 감싼 겉. 바깥 누름 판정의 기준이다
 * @param {import("vue").Ref} o.anchor 기준이 될 칸(입력칸 또는 버튼)
 * @param {import("vue").Ref} o.panel  띄울 패널. 바깥 누름 판정에 같이 쓴다
 * @param {import("vue").Ref} o.open   열림 상태. 바깥을 누르면 여기를 내린다
 * @param {number} [o.maxHeight] 패널이 바랄 최대 높이(px)
 * @param {number} [o.gap]       칸과 패널 사이 간격(px). 음수면 테두리를 겹친다
 */
export function useAnchoredPanel({ root, anchor, panel, open, maxHeight = 256, gap = -1 }) {
  const style = ref({});
  let observer = null;

  function place() {
    const el = anchor.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const floor = window.innerHeight - coveredBottom(el);
    const below = floor - rect.bottom - gap;
    const above = rect.top - gap;
    // 아래가 바라는 만큼 안 되고 위가 더 넓을 때만 뒤집는다. 조금 좁다고 매번 뒤집으면
    // 스크롤할 때 패널이 왔다 갔다 한다.
    const flip = below < Math.min(maxHeight, 160) && above > below;

    style.value = {
      position: "fixed",
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${Math.max(80, Math.min(maxHeight, flip ? above : below))}px`,
      zIndex: 160,
      ...(flip ? { bottom: `${window.innerHeight - rect.top + gap}px` } : { top: `${rect.bottom + gap}px` }),
    };
  }

  function onDocClick(event) {
    // 패널은 body 로 나가 있어 root 안에 없다. 둘 다 보지 않으면 고르는 순간 닫힌다.
    const inside = root.value?.contains(event.target) || panel.value?.contains(event.target);
    if (!inside) open.value = false;
  }

  function listen(on) {
    const how = on ? "addEventListener" : "removeEventListener";
    document[how]("click", onDocClick, true);
    document[how]("scroll", place, true);
    window[how]("resize", place);
  }

  watch(open, (now) => {
    listen(now);
    if (now) {
      // 먼저 한 번 잡고 그린다. 자리를 nextTick 으로 미루면 패널이 한 프레임 동안
      // 문서 맨 끝에 그려지고, 그쪽에 초점이 가면 브라우저가 페이지를 바닥까지 내린다.
      place();
      nextTick(place);
      if (anchor.value && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(place);
        observer.observe(anchor.value);
      }
    } else {
      observer?.disconnect();
      observer = null;
    }
  });

  onBeforeUnmount(() => {
    listen(false);
    observer?.disconnect();
  });

  return { style, place };
}
