// 운영자 패널의 목록 · 상세 편집기(자동재생 장르 · 상태 문구)가 같이 쓰는 것(M3 목록 · 상세).
// - 넓으면(52rem 이상) 두 단, 좁으면 한 단씩. 한 단에서 열면 방문 기록이 하나 쌓여 OS · 브라우저 뒤로가기가 목록으로 돌아온다(두 단은 쌓지 않는다)
// - 선택한 항목은 주소(?<param>=이름, 이름이 비었거나 겹치면 @순번, 목록 첫 항목의 전역 값은 @defaults)에 둬 새로고침 · 저장 뒤에도 다시 찾는다
// - 두 단의 목록은 재생 바 옆이 비어 있으면 아래 끝까지 쓴다

import { computed, nextTick, reactive, ref, watch, type Ref } from "vue";
import { goUp, pushDown, replaceKeepingUp } from "../utils/up-nav.ts";
import { useRoute, useRouter } from "vue-router";
import { useElementBounding, useElementSize } from "@vueuse/core";
import { rem } from "../utils/rem.ts";
import { useNowPlayingStore } from "../stores/now-playing.ts";

/** 목록의 전역 값 항목의 주소 표식. 항목 표식의 @순번은 수만 쓰므로 겹치지 않는다 */
const GLOBAL_TOKEN = "@defaults";
/** 편집기마다(주소 표식 이름 → 지금 한 단으로 상세를 여는지). 운영자 패널이 위 막대 ← 를 보일지 정한다(태블릿에서도 한 단이면 ← 로 목록에) */
/** 목록 항목(48). 선택한 항목은 SELECT_ROW_ON, 끈 것은 흐리게(opacity) */
export const LIST_ROW = "state-layer flex items-center gap-3 h-12 pl-1 pr-3 rounded-(--r-row) cursor-pointer text-sm text-on-surface transition-[background-color,opacity] duration-150";

export const singlePane = reactive<Record<string, boolean>>({});
/** 주소 표식 param 의 편집기가 한 단이면 알린다. 떠날 때 지우지 않는다: 새로 그리는 순서(개발 서버의 HMR 등)에 따라 새 편집기가 쓴 값을
 *  옛 편집기가 지울 수 있고, 남은 값은 그 탭이 보일 때 다시 쓰이므로 해가 없다. 운영자 패널은 ← 를 표시할지에만 쓰고, 누른 뒤 할 일은 주소로 정한다 */
export function reportSinglePane(param: string, single: () => boolean) {
  watch(single, (v) => (singlePane[param] = v), { immediate: true });
}

type Row = { key: number; name: string };

/** 두 단 판단 · 목록 카드 높이 · 열 나누기만(선택은 부르는 쪽이 정할 때) */
export function useListDetailLayout(paneEl: Ref<HTMLElement | null>) {
  const { width: paneWidth } = useElementSize(paneEl);
  // 목록 20rem + 편집이 입력란을 두 줄로 놓을 만큼
  const twoPane = computed(() => paneWidth.value >= rem(52));

  // 재생 바 본체의 왼쪽 끝이 목록 오른쪽 끝 + 틈보다 바깥이면 노치의 오목한 모서리에 목록 아래 모서리가 끼워진다(운영자 레일과 같은 규칙).
  // 좁아서 재생 바와 겹치면 재생 바 위에서 멈춘다
  const np = useNowPlayingStore();
  const dockEl = ref<HTMLElement | null>(null);
  watch(
    () => np.visible,
    async (shown) => {
      await nextTick();
      dockEl.value = shown ? document.querySelector<HTMLElement>("[data-dock]") : null;
    },
    { immediate: true },
  );
  const dockBox = useElementBounding(dockEl);
  const paneBox = useElementBounding(paneEl);
  const besideDock = computed(() => {
    if (!twoPane.value || !dockEl.value || !paneEl.value) return false;
    const gap = parseFloat(getComputedStyle(paneEl.value).columnGap) || 0;
    return paneBox.left.value + rem(20) + gap <= dockBox.left.value + 0.5;
  });
  /** 두 단의 목록 카드: 제자리에 붙고, 길면 그 안에서 스크롤된다 */
  const listCardClass = computed(() => (twoPane.value ? ["sticky top-(--gap-out) flex flex-col", besideDock.value ? "max-h-[calc(var(--desk-h)-var(--gap-out)*2)] -mb-(--player)" : "max-h-[calc(var(--desk-h)-var(--gap-out)*2-var(--player))]"] : []));
  /** 두 단의 열 나누기(목록 20rem) */
  const paneClass = computed(() => (twoPane.value ? "grid grid-cols-[20rem_minmax(0,1fr)] items-start gap-(--gap-in)" : ""));
  return { twoPane, besideDock, listCardClass, paneClass };
}

export function useListDetail<R extends Row>({ param, rows, paneEl }: { param: string; rows: Ref<R[]>; paneEl: Ref<HTMLElement | null> }) {
  const route = useRoute();
  const router = useRouter();

  const { twoPane, besideDock, listCardClass, paneClass } = useListDetailLayout(paneEl);
  reportSinglePane(param, () => !twoPane.value);

  // ── 선택한 항목 ──
  // 주소의 표식: 이름이 있고 하나뿐이면 이름, 비었거나 겹치면 @순번
  function tokenOf(i: number) {
    const name = rows.value[i]?.name.trim();
    return name && rows.value.filter((r) => r.name.trim() === name).length === 1 ? name : `@${i}`;
  }
  // 주소의 표식이 가리키는 항목(없으면 -1)
  function indexOfQuery() {
    const q = route.query[param];
    if (typeof q !== "string" || !q) return -1;
    if (q.startsWith("@")) {
      const i = Number(q.slice(1));
      return Number.isInteger(i) && i >= 0 && i < rows.value.length ? i : -1;
    }
    return rows.value.findIndex((r) => r.name.trim() === q);
  }
  // 선택한 항목은 화면 안에서 key 로 붙잡는다. 주소는 여기서 따라 쓴다(이름을 고치는 동안 옛 이름으로 다시 찾으면 다른 항목으로 튄다).
  // 주소가 바뀌면(뒤로가기 · 새로고침 · 저장 뒤 다시 읽은 항목) 주소에서 다시 찾는다
  const selectedKey = ref<number | null>(null);
  watch([() => route.query[param], rows], () => {
    const i = indexOfQuery();
    selectedKey.value = i >= 0 ? rows.value[i].key : null;
  });
  const keyIndex = computed(() => rows.value.findIndex((r) => r.key === selectedKey.value));
  /** 목록 첫 항목의 전역 값을 열었는지 */
  const globalSelected = computed(() => route.query[param] === GLOBAL_TOKEN);
  // 두 단이면 선택한 것이 없을 때 첫 항목(전역 값)을 보인다. 한 단이면 선택한 것이 없을 때 목록만
  const selectedIndex = computed(() => (keyIndex.value >= 0 && !globalSelected.value ? keyIndex.value : -1));
  const selected = computed(() => rows.value[selectedIndex.value] ?? null);
  const showGlobal = computed(() => globalSelected.value || (twoPane.value && selectedIndex.value < 0));
  /** 한 단에서 목록을 보일지(상세를 열지 않았을 때) */
  const showList = computed(() => twoPane.value || (selectedIndex.value < 0 && !globalSelected.value));
  // 목록에서 칠할 항목(두 단일 때만)
  const isOn = (i: number) => twoPane.value && i === selectedIndex.value;
  const globalOn = computed(() => twoPane.value && showGlobal.value);

  const withoutParam = () => Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== param));
  function go(token: string) {
    const query = { ...route.query, [param]: token };
    if (twoPane.value) void router.replace({ query });
    else void pushDown(router, route, { query });
  }
  function select(i: number) {
    selectedKey.value = rows.value[i].key;
    go(tokenOf(i));
  }
  function openGlobal() {
    selectedKey.value = null;
    go(GLOBAL_TOKEN);
  }
  // 목록으로(늘 상위로, utils/up-nav): 목록에서 연 상세면 기록을 무르고(기기 뒤로와 같다), 아니면 주소만 바꾼다
  function backToList() {
    selectedKey.value = null;
    void goUp(router, { query: withoutParam() });
  }
  // 이름을 고치면 주소도 따라 고친다(기록은 쌓지 않고, 상세를 연 표시는 그대로)
  watch(
    () => (keyIndex.value >= 0 ? tokenOf(keyIndex.value) : null),
    (token) => {
      // 주소에 표식이 이미 있을 때만(선택하는 순간에는 select 가 쌓는 기록을 덮어쓰지 않게)
      const now = route.query[param];
      if (token && now && now !== GLOBAL_TOKEN && now !== token) void replaceKeepingUp(router, { query: { ...route.query, [param]: token } });
    },
  );
  /** 항목을 삭제한 뒤: 한 단이면 목록으로, 두 단이면 이웃 항목(없으면 전역 값) */
  function afterRemove(i: number, wasSelected: boolean) {
    if (!wasSelected) return;
    if (!twoPane.value) return backToList();
    if (rows.value.length) select(Math.min(i, rows.value.length - 1));
    else void router.replace({ query: withoutParam() });
  }

  return { twoPane, besideDock, listCardClass, paneClass, selectedIndex, selected, globalSelected, showGlobal, showList, isOn, globalOn, select, openGlobal, backToList, afterRemove };
}
