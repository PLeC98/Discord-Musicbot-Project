// 운영 조절값(/api/admin/tunables). 카드가 여러 탭에 나뉘어 있어도(일반 · 유튜브 · 디스플레이 탭) 저장된 값 · 고치는 중인 값 · 저장 번호는 하나를 같이 쓴다.
// 저장은 통째로 바꾸는 요청이라, 한 탭에서 저장할 때 다른 탭의 항목은 저장된 값으로 보내고 그 탭에서 고치는 중인 값은 그대로 둔다.
// 저장 번호를 같이 쓰므로 한 탭에서 저장한 뒤 다른 탭에서 저장해도 바뀌었다고(config-changed) 거절되지 않는다.
// 운영자 패널의 저장 막대에는 카드가 몇 탭에 떠 있든 하나로 올린다(모든 항목을 한 번에 저장 · 되돌린다).

import { computed, ref } from "vue";
import axios from "axios";
import { addSaveTarget } from "./save-targets.ts";
import { notifyDone, notifyProblem } from "./toasts.ts";
import { RESTART_KEYS, TUNABLES, tunableValue } from "../../../src/rules/tunables.ts";
import type { TunablesView } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.tunables;

const blank = () => Object.fromEntries(TUNABLES.map((one) => [one.key, ""])) as Record<string, string>;

// 저장된 값(비운 항목은 빈 글) · 고치는 중인 값 · 저장 번호 · 저장했지만 다시 시작해야 먹는 이름
export const saved = ref<Record<string, string>>(blank());
export const draft = ref<Record<string, string>>(blank());
export const pending = ref<string[]>([]);
export const loaded = ref(false);
const revision = ref(0);

/** 받은 값을 넣는다. keys 의 항목만 고치는 중인 값을 덮는다(나머지 탭에서 고치는 중인 값은 남긴다) */
function apply(view: TunablesView, keys: readonly string[]) {
  saved.value = { ...blank(), ...view.values };
  for (const key of keys) draft.value[key] = saved.value[key];
  revision.value = view.revision;
  pending.value = view.pending;
  loaded.value = true;
}

// 항목 이름(화면 라벨). 알림 · 안내에 "몇 항목" 대신 무엇인지 적는다
export const labelOf = (key: string) => T.fields[key]?.label ?? key;
export const namesOf = (keys: string[]) => keys.map(labelOf).join(" · ");

const ALL_KEYS = TUNABLES.map((one) => one.key);
const changedKey = (key: string) => tunableValue(key, draft.value[key] ?? "") !== (saved.value[key] ?? "");
const saving = ref(false);

/** 저장. 됐으면 true. restarting 이면 다시 시작해야 먹는다는 안내는 빼고 알린다(곧 다시 시작한다) */
async function saveAllKeys(restarting: boolean): Promise<boolean> {
  saving.value = true;
  try {
    const view = await saveKeys(ALL_KEYS);
    notifyDone(T.savedDone, view.pending.length && !restarting ? T.savedRestart(namesOf(view.pending)) : "");
    return true;
  } catch (err) {
    notifyProblem(err, T.saveFailed);
    return false;
  } finally {
    saving.value = false;
  }
}

const target = {
  tab: "settings",
  dirty: computed(() => loaded.value && ALL_KEYS.some(changedKey)),
  saving,
  // 다시 시작해야 먹는 값을 고쳤거나, 저장해 두고 아직 다시 시작하지 않은 값이 있다
  restart: computed(() => [...RESTART_KEYS].some(changedKey) || pending.value.length > 0),
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

/** keys 의 항목만 저장한다. 나머지 항목은 저장된 값으로 보낸다 */
export async function saveKeys(keys: readonly string[]): Promise<TunablesView> {
  const mine = new Set(keys);
  const sent = Object.fromEntries(TUNABLES.map((one) => [one.key, mine.has(one.key) ? draft.value[one.key] : saved.value[one.key]]).filter(([, value]) => value.trim()));
  const view = (await axios.put<TunablesView>("/api/admin/tunables", { values: sent, revision: revision.value })).data;
  apply(view, keys);
  return view;
}

/** keys 의 항목을 저장된 값으로 되돌린다 */
export function revertKeys(keys: readonly string[]) {
  for (const key of keys) draft.value[key] = saved.value[key];
}
