import { ref } from "vue";
import { readStored, writeStored } from "../utils/storage.ts";

// 자동재생 설정에서 접어 둔 카드. 장르와 그 안의 출처.
//
// 접은 것만 적는다. 새로 만든 장르·출처는 펼친 채로 나오고, 저장한 적 없는 것도 펼쳐진다.
// 자리(번호)로 기억한다. 이름으로 기억하면 이름을 고치는 순간 잃는다. 그래서 지우거나 차례를 바꾸면
// 편집기가 새 차례를 알려(reorderGenres · reorderSources) 기억을 따라 옮긴다.
const STORE_KEY = "configGenres.folded";
// 출처의 상세 설정을 펼쳐 둔 것. 접기와 반대로 펼친 것만 적는다(상세 설정은 접힌 채로 나온다).
// 편집기 안에 두면 저장할 때 사라진다. 저장하면 장르 목록을 새로 받아 편집기를 다시 그리기 때문이다.
const DEEP_KEY = "configGenres.deepOpen";

/** 저장해 둔 카드 번호들. 저장한 것이 깨졌거나 읽을 수 없는 브라우저면 빈 것(다 기본 모양으로 시작한다) */
function load(key: string): Set<string> {
  try {
    const list: unknown = JSON.parse(readStored(key) || "[]");
    return new Set(Array.isArray(list) ? list.filter((one): one is string => typeof one === "string") : []);
  } catch {
    return new Set();
  }
}

// 사생활 보호 모드 등에서는 저장하지 못한다. 이번 세션 동안만 기억한다
const save = (key: string, set: Set<string>) => writeStored(key, JSON.stringify([...set]));

const folded = ref(load(STORE_KEY));
const deepOpen = ref(load(DEEP_KEY));

export const sourceFoldId = (genreIndex: number, i: number) => `g${genreIndex}s${i}`;
export const promptFoldId = (i: number) => `p${i}`;
export const isFolded = (id: string) => folded.value.has(id);
export const isDeepOpen = (id: string) => deepOpen.value.has(id);

/** 하나를 넣거나 뺀 새 모음 */
function toggled(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function toggleFold(id: string): void {
  folded.value = toggled(folded.value, id);
  save(STORE_KEY, folded.value);
}

export function toggleDeepOpen(id: string): void {
  deepOpen.value = toggled(deepOpen.value, id);
  save(DEEP_KEY, deepOpen.value);
}

/** 기억 하나에서 고칠 번호와, 새 번호로 다시 만드는 법. 고칠 것이 아니면 null */
type Pick = (id: string) => { index: number; rebuild: (at: number) => string } | null;

// 기억의 자리를 옮긴다. ids 의 각 값에서 고칠 번호를 찾아 옛 번호 → 새 번호(없으면 기억을 버린다)
function remap(ids: Set<string>, pick: Pick, order: number[]) {
  const next = new Set<string>();
  for (const id of ids) {
    const m = pick(id);
    if (!m) next.add(id);
    else if (order.includes(m.index)) next.add(m.rebuild(order.indexOf(m.index)));
  }
  return next;
}

/** 접기 · 상세 펼침 기억을 함께 옮긴다 */
function moveBoth(pick: Pick, order: number[]) {
  folded.value = remap(folded.value, pick, order);
  deepOpen.value = remap(deepOpen.value, pick, order);
  save(STORE_KEY, folded.value);
  save(DEEP_KEY, deepOpen.value);
}

/** 장르의 새 차례(옛 번호의 목록, 지운 것은 빠진다). 그 장르의 출처 기억도 함께 옮긴다 */
export function reorderGenres(order: number[]): void {
  moveBoth((id) => {
    const m = /^g(\d+)(s\d+)?$/.exec(id);
    return m && { index: Number(m[1]), rebuild: (at) => `g${at}${m[2] ?? ""}` };
  }, order);
}

/** 한 장르 안 출처의 새 차례 */
export function reorderSources(genreIndex: number, order: number[]): void {
  moveBoth((id) => {
    const m = new RegExp(`^g${genreIndex}s(\\d+)$`).exec(id);
    return m && { index: Number(m[1]), rebuild: (at) => sourceFoldId(genreIndex, at) };
  }, order);
}

/** 접기만 기억하는 카드(번호 하나)의 새 차례. prefix 는 카드 종류의 머리 글자 */
function moveFolded(prefix: string, rebuild: (at: number) => string, order: number[]) {
  const shape = new RegExp(`^${prefix}(\\d+)$`);
  folded.value = remap(
    folded.value,
    (id) => {
      const m = shape.exec(id);
      return m && { index: Number(m[1]), rebuild };
    },
    order,
  );
  save(STORE_KEY, folded.value);
}

/** AI 프롬프트 섹션의 새 차례 */
export const reorderPrompts = (order: number[]) => moveFolded("p", promptFoldId, order);
