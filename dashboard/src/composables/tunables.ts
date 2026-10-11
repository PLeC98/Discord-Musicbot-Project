// 운영 조절값(/api/admin/tunables). 카드가 여러 탭에 나뉘어 있어도(설정 탭 · 디스플레이 탭) 저장된 값 · 고치는 중인 값 · 저장 번호는 하나를 같이 쓴다.
// 저장은 통째로 바꾸는 요청이라, 한 탭에서 저장할 때 다른 탭의 칸은 저장된 값으로 보내고 그 탭에서 고치는 중인 값은 그대로 둔다.
// 저장 번호를 같이 쓰므로 한 탭에서 저장한 뒤 다른 탭에서 저장해도 바뀌었다고(config-changed) 거절되지 않는다.

import { ref } from "vue";
import axios from "axios";
import { TUNABLES } from "../../../src/rules/tunables.ts";
import type { TunablesView } from "../../../src/dashboard/contract/admin.ts";

const blank = () => Object.fromEntries(TUNABLES.map((one) => [one.key, ""])) as Record<string, string>;

// 저장된 값(비운 칸은 빈 글) · 고치는 중인 값 · 저장 번호 · 저장했지만 다시 켜야 먹는 이름
export const saved = ref<Record<string, string>>(blank());
export const draft = ref<Record<string, string>>(blank());
export const pending = ref<string[]>([]);
export const loaded = ref(false);
const revision = ref(0);

/** 받은 값을 들인다. keys 의 칸만 고치는 중인 값을 덮는다(나머지 탭에서 고치는 중인 값은 남긴다) */
function apply(view: TunablesView, keys: readonly string[]) {
  saved.value = { ...blank(), ...view.values };
  for (const key of keys) draft.value[key] = saved.value[key];
  revision.value = view.revision;
  pending.value = view.pending;
  loaded.value = true;
}

let reading: Promise<void> | null = null;
let users = 0;

/** 카드가 뜰 때 읽는다. 함께 뜬 카드끼리는 한 번만 읽고, 모두 사라졌다가(운영자 패널을 떠났다 돌아옴) 다시 뜨면 새로 읽는다. 돌려준 것을 사라질 때 부른다 */
export function attach(): { ready: Promise<void>; detach: () => void } {
  users += 1;
  return {
    ready: read(),
    detach: () => {
      users -= 1;
      if (!users) reading = null;
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

/** keys 의 칸만 저장한다. 나머지 칸은 저장된 값으로 보낸다 */
export async function saveKeys(keys: readonly string[]): Promise<TunablesView> {
  const mine = new Set(keys);
  const sent = Object.fromEntries(TUNABLES.map((one) => [one.key, mine.has(one.key) ? draft.value[one.key] : saved.value[one.key]]).filter(([, value]) => value.trim()));
  const view = (await axios.put<TunablesView>("/api/admin/tunables", { values: sent, revision: revision.value })).data;
  apply(view, keys);
  return view;
}

/** keys 의 칸을 저장된 값으로 되돌린다 */
export function revertKeys(keys: readonly string[]) {
  for (const key of keys) draft.value[key] = saved.value[key];
}
