// AI 리퀘스트 로그 화면의 상태: 필터, 페이지 넘기기(앞 페이지 마지막 id 뒤로), 펼친 줄의 원문, 실시간 새 기록, 전체 삭제.
// SSE 연결은 화면이 보일 때만 연다(active). 새 기록은 맨 위를 보고 있고 펼친 줄이 없으면 바로 붙이고, 아니면 모아 두었다가 새 기록 칩을 누르면 붙인다(읽는 줄이 밀리지 않게).

import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import axios from "axios";
import { eventLink } from "../utils/event-link.ts";
import { live as canStream, session } from "./session.ts";
import { checkSession } from "../stores/user.ts";
import { problemText } from "../utils/problem.ts";
import { notifyDone, notifyProblem } from "./toasts.ts";
import { AI_LOG_PAGE, aiLogMatches, type AiLogDetail, type AiLogEntry, type AiLogPage, type AiLogPushed, type AiLogQuery, type AiLogSource, type AiLogStorage } from "../../../src/dashboard/contract/ai-log.ts";
import { text } from "../text/index.ts";
const T = text.ai.log;

/** 펼친 줄의 원문: 불러오는 중, 못 불러옴, 불러온 것 */
type Detail = AiLogDetail | "loading" | "error";

/** 검색어는 입력할 때마다 요청하지 않고 잠깐 멈추면 요청한다 */
const SEARCH_WAIT_MS = 300;

function queryString(query: AiLogQuery, before?: number) {
  const params = new URLSearchParams({ limit: String(AI_LOG_PAGE) });
  if (query.sources.length) params.set("sources", query.sources.join(","));
  if (query.result) params.set("result", query.result);
  if (query.q.trim()) params.set("q", query.q.trim());
  if (before !== undefined) params.set("before", String(before));
  return params.toString();
}

/** 목록, 필터, 페이지 넘기기 */
function listState() {
  const entries = ref<AiLogEntry[]>([]);
  const total = ref(0);
  const matched = ref(0);
  const storage = ref<AiLogStorage | null>(null);
  const loading = ref(false);
  const loadError = ref("");
  const query = reactive<AiLogQuery>({ sources: [], result: "", q: "" });
  const more = computed(() => entries.value.length < matched.value);
  // 늦게 온 앞 요청의 답이 새 필터의 답을 덮지 않게 순서를 센다
  let seq = 0;

  function take(page: AiLogPage, append: boolean) {
    entries.value = append ? [...entries.value, ...page.entries] : page.entries;
    total.value = page.total;
    matched.value = page.matched;
    storage.value = page.storage;
  }
  async function load(append = false) {
    const mine = ++seq;
    loading.value = true;
    try {
      const before = append ? entries.value.at(-1)?.id : undefined;
      const page = (await axios.get<AiLogPage>(`/api/admin/ai/logs?${queryString(query, before)}`)).data;
      if (mine !== seq) return;
      take(page, append);
      loadError.value = "";
    } catch (error) {
      if (mine === seq) loadError.value = problemText(error, T.loadFailed);
    } finally {
      if (mine === seq) loading.value = false;
    }
  }
  const filterCount = computed(() => (query.sources.length ? 1 : 0) + (query.result ? 1 : 0));
  function toggleSource(source: AiLogSource) {
    query.sources = query.sources.includes(source) ? query.sources.filter((one) => one !== source) : [...query.sources, source];
  }
  function toggleResult(result: "ok" | "failed") {
    query.result = query.result === result ? "" : result;
  }
  function clearFilters() {
    query.sources = [];
    query.result = "";
  }
  return { entries, total, matched, storage, loading, loadError, query, more, load, filterCount, toggleSource, toggleResult, clearFilters };
}
type List = ReturnType<typeof listState>;

/** 펼친 줄과 그 원문(펼칠 때 불러온다) */
function detailState() {
  const open = ref(new Set<number>());
  const details = ref<Record<number, Detail>>({});
  async function fetchDetail(id: number) {
    details.value = { ...details.value, [id]: "loading" };
    try {
      const one = (await axios.get<AiLogDetail>(`/api/admin/ai/logs/${id}`)).data;
      details.value = { ...details.value, [id]: one };
    } catch {
      details.value = { ...details.value, [id]: "error" };
    }
  }
  function toggle(id: number) {
    const next = new Set(open.value);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      const had = details.value[id];
      if (!had || had === "error") void fetchDetail(id);
    }
    open.value = next;
  }
  function reset() {
    open.value = new Set();
    details.value = {};
  }
  return { open, details, toggle, reset };
}

/** 실시간 새 기록. atTop: 목록 맨 위를 보고 있는가(화면이 알려 준다) */
function liveState(list: List, open: { value: Set<number> }) {
  const fresh = ref<AiLogEntry[]>([]);
  const atTop = ref(true);
  const connected = ref(false);
  let lastId = 0;
  function onPushed(pushed: AiLogPushed) {
    lastId = Math.max(lastId, pushed.entry.id);
    list.total.value = pushed.total;
    list.storage.value = pushed.storage;
    if (!aiLogMatches(pushed.entry, list.query) || list.entries.value.some((one) => one.id === pushed.entry.id)) return;
    list.matched.value += 1;
    if (atTop.value && open.value.size === 0 && !fresh.value.length) list.entries.value = [pushed.entry, ...list.entries.value];
    else fresh.value = [pushed.entry, ...fresh.value];
  }
  function showFresh() {
    list.entries.value = [...fresh.value, ...list.entries.value];
    fresh.value = [];
  }
  const link = eventLink({
    url: () => `/api/admin/ai/logs/stream?after=${lastId}`,
    open: (url) => new EventSource(url, { withCredentials: true }),
    check: (quiet) => checkSession(quiet),
    onState: (state) => (connected.value = state === "open"),
    // gap: 다시 붙을 때 놓친 줄을 다 받지 못했다(서버의 상한). 목록을 다시 읽어 빈 곳을 채운다
    events: {
      message: (event) => onPushed(JSON.parse(String(event.data)) as AiLogPushed),
      // 놓친 줄의 마지막 번호가 실려 온다. 화면이 다시 열 때도 그 뒤부터 받게
      gap: (event) => {
        lastId = Math.max(lastId, Number(event.lastEventId) || 0);
        onGap();
      },
    },
  });
  let onGap: () => void = () => undefined;
  function start() {
    lastId = list.entries.value[0]?.id ?? 0;
    link.start();
  }
  function stop() {
    link.stop();
    connected.value = false;
  }
  return { fresh, atTop, connected, showFresh, start, stop, whenGap: (fn: () => void) => (onGap = fn) };
}

/** 리퀘스트 로그 화면 하나. active: 화면이 보이는가(보일 때 읽고 SSE 연결을 연다) */
export function useAiLog(active: () => boolean) {
  const list = listState();
  const detail = detailState();
  const live = liveState(list, detail.open);
  const clearing = ref(false);

  async function reload() {
    detail.reset();
    live.fresh.value = [];
    await list.load();
  }
  async function clearAll() {
    clearing.value = true;
    try {
      await axios.delete("/api/admin/ai/logs");
      notifyDone(T.cleared);
      await reload();
    } catch (error) {
      notifyProblem(error, T.clearFailed);
    } finally {
      clearing.value = false;
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  watch([() => list.query.sources, () => list.query.result], () => void reload());
  watch(
    () => list.query.q,
    () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void reload(), SEARCH_WAIT_MS);
    },
  );
  // 화면이 보이고(active), 탭이 보이고 세션이 살아 있을 때만 연다(다른 두 스트림과 같다). 읽기를 기다리는 사이 바뀌었거나 화면이 사라졌으면 열지 않는다.
  // 다시 읽기는 처음 열 때, 화면을 떠났다 올 때, 세션이 끝났다 다시 로그인했을 때만. 탭을 숨겼다 보이는 것은 이어 받기로 충분하다(펼친 줄, 더 읽은 줄을 지킨다)
  let disposed = false;
  let turn = 0;
  let stale = true;
  const wanted = () => !disposed && active() && canStream();
  async function sync() {
    const mine = ++turn;
    if (!active() || session.ended) stale = true;
    if (!wanted()) return live.stop();
    if (stale) {
      await reload();
      if (mine !== turn || !wanted()) return;
      // 읽지 못했으면 다음에 다시 읽는다
      stale = Boolean(list.loadError.value);
    }
    live.start();
  }
  live.whenGap(() => void reload());
  watch([active, () => session.ended], () => void sync(), { immediate: true });
  // 숨긴 탭의 값(document.hidden)은 반응형이 아니라 따로 듣는다
  const onVisibility = () => void sync();
  document.addEventListener("visibilitychange", onVisibility);

  onScopeDispose(() => {
    disposed = true;
    turn++;
    document.removeEventListener("visibilitychange", onVisibility);
    clearTimeout(searchTimer);
    live.stop();
  });

  return { ...list, ...detail, ...live, clearing, reload, loadMore: () => list.load(true), clearAll };
}
