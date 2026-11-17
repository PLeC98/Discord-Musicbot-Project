// 운영 설정값(/api/admin/tunables). 카드가 여러 탭에 나뉘어 있어도(일반, 유튜브, 디스플레이 탭) 저장된 값, 고치는 중인 값, 저장 번호는 하나를 같이 쓴다.
// 저장은 통째로 바꾸는 요청이라, 한 탭에서 저장할 때 다른 탭의 항목은 저장된 값으로 보내고 그 탭에서 고치는 중인 값은 그대로 둔다.
// 저장 번호를 같이 쓰므로 한 탭에서 저장한 뒤 다른 탭에서 저장해도 바뀌었다고(config-changed) 거절되지 않는다.
// 운영자 패널의 저장 바에는 카드가 몇 탭에 떠 있든 하나로 올린다(모든 항목을 한 번에 저장, 되돌린다).
// 도구 카드가 고치는 값(card, yt-dlp의 채널, 모드, 버전 고정)은 저장 바에 올리지 않는다. 그 카드가 자기 API로 바로 저장하고 응답의 설정값 상태를 applyCard로 반영한다.

import { computed, ref } from "vue";
import axios from "axios";
import { addSaveTarget } from "./save-targets.ts";
import { notifyDone, notifyProblem } from "./toasts.ts";
import { GROUP_TAB, RESTART_KEYS, TUNABLES, TUNABLE_KEYS, parseTuneProblem, tunable, tunableValue } from "../../../src/rules/tunables.ts";
import { problemDetails } from "../utils/problem.ts";
import type { TunablesView } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.tunables;

const blank = () => Object.fromEntries(TUNABLES.map((one) => [one.key, ""])) as Record<string, string>;

// 저장된 값(비운 항목은 빈 글), 고치는 중인 값, 저장 번호, 저장했지만 다시 시작해야 적용되는 이름
export const saved = ref<Record<string, string>>(blank());
export const draft = ref<Record<string, string>>(blank());
export const pending = ref<string[]>([]);
export const loaded = ref(false);
const revision = ref(0);

/** 받은 값을 반영한다. keys의 항목만 고치는 중인 값을 덮는다(나머지 탭에서 고치는 중인 값은 남긴다) */
function apply(view: TunablesView, keys: readonly string[]) {
  saved.value = { ...blank(), ...view.values };
  for (const key of keys) draft.value[key] = saved.value[key];
  revision.value = view.revision;
  pending.value = view.pending;
  loaded.value = true;
}

// 항목 이름(화면 라벨). 알림, 안내에 "몇 항목" 대신 무엇인지 적는다
export const labelOf = (key: string) => T.fields[key]?.label ?? key;
export const namesOf = (keys: string[]) => keys.map(labelOf).join(", ");

/** 저장 거절의 줄(틀린 설정값)을 "라벨 [넣은 값]: 원인"으로. 다른 모양은 그대로 */
export function problemLine(line: string): string {
  const found = parseTuneProblem(line);
  return found ? T.problemLine(labelOf(found.key), found.value, found.reason) : line;
}

// 저장 바가 다루는 항목(도구 카드의 값은 뺀다)
const ALL_KEYS = TUNABLES.filter((one) => !one.card).map((one) => one.key);
const changedKey = (key: string) => tunableValue(key, draft.value[key] ?? "") !== (saved.value[key] ?? "");
const saving = ref(false);
// 마지막 저장 거절에서 틀린 값이 든 탭. 이름을 모르는 실패(충돌, 연결)면 비어 있다
let failedTabs: string[] = [];

/** 저장 거절의 줄에서 틀린 값이 든 탭 */
export const tabsOf = (error: unknown) => [
  ...new Set(
    problemDetails(error).flatMap((line) => {
      const key = parseTuneProblem(line)?.key;
      return key && TUNABLE_KEYS.has(key) ? [GROUP_TAB[tunable(key).group]] : [];
    }),
  ),
];

/** 저장. 됐으면 true. restarting이면 다시 시작해야 적용된다는 안내는 빼고 알린다(곧 다시 시작한다) */
async function saveAllKeys(restarting: boolean): Promise<boolean> {
  saving.value = true;
  failedTabs = [];
  try {
    const view = await saveKeys(ALL_KEYS);
    notifyDone(T.savedDone, view.pending.length && !restarting ? T.savedRestart(namesOf(view.pending)) : "");
    return true;
  } catch (err) {
    failedTabs = tabsOf(err);
    notifyProblem(err, T.saveFailed, problemLine);
    return false;
  } finally {
    saving.value = false;
  }
}

const target = {
  tab: "settings",
  dirty: computed(() => loaded.value && ALL_KEYS.some(changedKey)),
  saving,
  // 다시 시작해야 적용되는 값을 고쳤거나, 저장해 두고 아직 다시 시작하지 않은 값이 있다
  restart: computed(() => [...RESTART_KEYS].some(changedKey) || pending.value.length > 0),
  failedTabs: () => failedTabs,
  save: saveAllKeys,
  revert: () => revertKeys(ALL_KEYS),
};

let reading: Promise<void> | null = null;
let users = 0;
let offTarget: (() => void) | null = null;

/** 카드가 뜰 때 읽는다. 함께 뜬 카드끼리는 한 번만 읽고, 모두 사라졌다가(운영자 패널을 떠났다 돌아옴) 다시 뜨면 새로 읽는다. 돌려준 것을 사라질 때 부른다 */
export function attach(): { ready: Promise<void>; detach: () => void } {
  users += 1;
  offTarget ??= addSaveTarget(target);
  return {
    ready: read(),
    detach: () => {
      users -= 1;
      if (users) return;
      reading = null;
      offTarget?.();
      offTarget = null;
    },
  };
}

function read(): Promise<void> {
  reading ??= axios
    .get<TunablesView>("/api/admin/tunables")
    .then(({ data }) => apply(data, Object.keys(blank())))
    .catch((err: unknown) => {
      reading = null;
      throw err;
    });
  return reading;
}

// 설정값 상태를 바꾸는 요청(저장 바의 저장, 도구 카드의 조작)을 하나씩 차례로 보낸다. 앞 요청의 응답(저장 번호)을 반영한 뒤에 다음을 보내야 저장 번호가 어긋나지 않는다
let queue: Promise<unknown> = Promise.resolve();
export function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** keys의 항목만 저장한다. 나머지 항목은 저장된 값으로 보낸다(도구 카드의 값은 보내지 않는다. 서버가 저장된 값을 그대로 둔다) */
export function saveKeys(keys: readonly string[]): Promise<TunablesView> {
  return inOrder(async () => {
    const mine = new Set(keys);
    const sent = Object.fromEntries(ALL_KEYS.map((key) => [key, mine.has(key) ? draft.value[key] : saved.value[key]]).filter(([, value]) => value.trim()));
    const view = (await axios.put<TunablesView>("/api/admin/tunables", { values: sent, revision: revision.value })).data;
    apply(view, keys);
    return view;
  });
}

/**
 * 도구 카드의 조작이 돌려준 설정값 상태를 반영한다. 저장 바에서 고치던 값은 그대로 두고, 고치지 않던 항목은 새 저장된 값을 따른다
 * (따르지 않으면 그사이 다른 사람이 저장한 값을 내가 고친 것으로 보고 다음 저장이 옛 값으로 덮어쓴다).
 * 고치던 항목을 그사이 다른 사람도 저장했으면 저장 번호를 올리지 않는다. 다음 저장이 config-changed로 거절되어 새로 불러오게 된다
 */
export function applyCard(view: TunablesView) {
  const next = { ...blank(), ...view.values };
  let clash = false;
  for (const key of ALL_KEYS) {
    if (!changedKey(key)) draft.value[key] = next[key];
    else if ((saved.value[key] ?? "") !== next[key]) clash = true;
  }
  saved.value = next;
  for (const { key, card } of TUNABLES) if (card) draft.value[key] = next[key];
  if (!clash) revision.value = view.revision;
  pending.value = view.pending;
}

/** keys의 항목을 저장된 값으로 되돌린다 */
export function revertKeys(keys: readonly string[]) {
  for (const key of keys) draft.value[key] = saved.value[key];
}
