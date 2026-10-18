// 입력란 아래에 붙여 표시하는 패널의 위치를 잡는다. 드롭다운 목록이 쓴다.
//
// 그냥 absolute 로 두면 카드 · 스크롤되는 영역 안에 갇히고, 아래 고정 재생바에도 깔린다.
// 그래서 body 로 내보내고(Teleport) 좌표를 직접 준다. fixed 만으로는 안 된다.
// 조상에 transform · filter · backdrop-filter 가 걸리면 그 조상이 fixed 의 기준이 되기 때문이다.
//
// 위치를 잡고 나면 세 가지를 더 본다.
//   아래가 패널 내용을 다 담지 못하고 위가 더 넓으면 위로 뒤집는다. 아래 재생바가 가리는 만큼은 빼고 본다.
//   스크롤과 창 크기 변화를 따라간다. 내부 스크롤 영역도 잡으려면 캡처로 들어야 한다.
//   입력란 자체가 커지면(칩이 늘면) 다시 잰다.
import { ref, nextTick, watch, onBeforeUnmount, type Ref, type CSSProperties } from "vue";

type ElementRef = Readonly<Ref<HTMLElement | null | undefined>>;

// 재생바가 가리는 높이. --player 는 App.vue 가 트리에 얹으므로 입력란에서 물려받아 읽는다.
export function coveredBottom(el: HTMLElement) {
  const raw = getComputedStyle(el).getPropertyValue("--player").trim();
  const n = parseFloat(raw);
  if (!n) return 0;
  return raw.endsWith("rem") ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
}

/** 패널의 쌓임 순서: 기준 요소가 든 층(z-index 를 가진 조상 중 가장 높은 것, 대화상자 등)보다 한 단계 위. 층이 없으면 PANEL_Z */
const PANEL_Z = 160;
function layerAbove(el: HTMLElement) {
  let top = PANEL_Z - 1;
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    const z = parseInt(getComputedStyle(at).zIndex, 10);
    if (Number.isFinite(z)) top = Math.max(top, z);
  }
  return top + 1;
}

/**
 * root: 입력란을 감싼 겉(바깥 누름 판정의 기준) · anchor: 기준이 될 요소(입력란 또는 버튼) · panel: 표시할 패널(바깥 누름 판정에 같이 쓴다)
 * open: 열림 상태(바깥을 누르면 여기를 내린다) · maxHeight: 패널이 바랄 최대 높이(px) · gap: 기준 요소와 패널 사이 간격(px, 음수면 테두리를 겹친다)
 */
export function useAnchoredPanel({ root, anchor, panel, open, maxHeight = 256, gap = -1 }: { root: ElementRef; anchor: ElementRef; panel: ElementRef; open: Ref<boolean>; maxHeight?: number; gap?: number }) {
  const style = ref<CSSProperties>({});
  let observer: ResizeObserver | null = null;
  /** 패널이 줄지 않고 다 보이는 높이. 열 때 한 번 잰다(검색으로 항목이 줄 때 뒤집히지 않게) */
  let need = maxHeight;

  // 스크롤 영역이 줄어 있어도 안의 내용 높이(scrollHeight)로 센다
  function naturalHeight(box: HTMLElement) {
    const cs = getComputedStyle(box);
    let height = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    for (const child of box.children) height += (child as HTMLElement).scrollHeight;
    return Math.min(maxHeight, height);
  }

  function place() {
    const el = anchor.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const floor = window.innerHeight - coveredBottom(el);
    const below = floor - rect.bottom - gap;
    const above = rect.top - gap;
    // 아래가 내용을 다 담지 못하고 위가 더 넓을 때만 뒤집는다. 기준이 내용 높이 하나라 스크롤하며 그 선을 넘을 때 한 번만 바뀐다
    const flip = below < need && above > below;

    style.value = {
      position: "fixed",
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${Math.max(80, Math.min(maxHeight, flip ? above : below))}px`,
      zIndex: layerAbove(el),
      ...(flip ? { bottom: `${window.innerHeight - rect.top + gap}px` } : { top: `${rect.bottom + gap}px` }),
    };
  }

  function onDocClick(event: MouseEvent) {
    // 패널은 body 로 나가 있어 root 안에 없다. 둘 다 보지 않으면 선택하는 순간 닫힌다.
    const target = event.target instanceof Node ? event.target : null;
    const inside = root.value?.contains(target) || panel.value?.contains(target);
    if (!inside) open.value = false;
  }

  function listen(on: boolean) {
    if (on) {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
    } else {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    }
  }

  watch(open, (now) => {
    listen(now);
    if (now) {
      // 먼저 한 번 잡고 그린다. 위치를 nextTick 으로 미루면 패널이 한 프레임 동안
      // 문서 맨 끝에 그려지고, 그쪽에 포커스가 가면 브라우저가 페이지를 바닥까지 내린다.
      need = maxHeight;
      place();
      void nextTick(() => {
        if (panel.value) need = naturalHeight(panel.value);
        place();
      });
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
