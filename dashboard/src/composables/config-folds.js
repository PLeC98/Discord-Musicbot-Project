import { ref } from "vue";

// 자동재생 설정에서 접어 둔 카드. 장르와 그 안의 출처.
//
// 접은 것만 적는다. 새로 만든 장르·출처는 펼친 채로 나오고, 저장한 적 없는 것도 펼쳐진다.
// 자리(번호)로 기억한다. 이름으로 기억하면 이름을 고치는 순간 잃는다. 그래서 지우거나 차례를 바꾸면
// 편집기가 새 차례를 알려(reorderGenres · reorderSources) 기억을 따라 옮긴다.
const STORE_KEY = "configGenres.folded";

function load() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]"));
  } catch {
    return new Set(); // 저장한 것이 깨졌거나 읽을 수 없는 브라우저. 다 펼친 채로 시작한다
  }
}

const folded = ref(load());

export const genreFoldId = (i) => `g${i}`;
export const sourceFoldId = (genreIndex, i) => `g${genreIndex}s${i}`;
export const promptFoldId = (i) => `p${i}`;
export const specialFoldId = (i) => `s${i}`;
export const isFolded = (id) => folded.value.has(id);

export function toggleFold(id) {
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  folded.value = next;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
  } catch {
    // 사생활 보호 모드 등. 이번 세션 동안만 접힌다
  }
}

// 기억의 자리를 옮긴다. ids 의 각 값에서 고칠 번호를 찾아 옛 번호 → 새 번호(없으면 기억을 버린다)
function remap(ids, pick, order) {
  const next = new Set();
  for (const id of ids) {
    const m = pick(id);
    if (!m) next.add(id);
    else if (order.includes(m.index)) next.add(m.rebuild(order.indexOf(m.index)));
  }
  return next;
}

/** 장르의 새 차례(옛 번호의 목록, 지운 것은 빠진다). 그 장르의 출처 기억도 함께 옮긴다 */
export function reorderGenres(order) {
  const pick = (id) => {
    const m = /^g(\d+)(s\d+)?$/.exec(id);
    return m && { index: Number(m[1]), rebuild: (at) => `g${at}${m[2] ?? ""}` };
  };
  folded.value = remap(folded.value, pick, order);
  deepOpen.value = remap(deepOpen.value, pick, order);
  save(STORE_KEY, folded.value);
  save(DEEP_KEY, deepOpen.value);
}

/** 한 장르 안 출처의 새 차례 */
export function reorderSources(genreIndex, order) {
  const pick = (id) => {
    const m = new RegExp(`^g${genreIndex}s(\\d+)$`).exec(id);
    return m && { index: Number(m[1]), rebuild: (at) => sourceFoldId(genreIndex, at) };
  };
  folded.value = remap(folded.value, pick, order);
  deepOpen.value = remap(deepOpen.value, pick, order);
  save(STORE_KEY, folded.value);
  save(DEEP_KEY, deepOpen.value);
}

/** 상태 문구의 특별 문구 카드의 새 차례 */
export function reorderSpecials(order) {
  const pick = (id) => {
    const m = /^s(\d+)$/.exec(id);
    return m && { index: Number(m[1]), rebuild: (at) => specialFoldId(at) };
  };
  folded.value = remap(folded.value, pick, order);
  save(STORE_KEY, folded.value);
}

function save(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // 사생활 보호 모드 등. 이번 세션 동안만 기억한다
  }
}

// 출처의 상세 설정을 펼쳐 둔 것. 접기와 반대로 펼친 것만 적는다(상세 설정은 접힌 채로 나온다).
// 편집기 안에 두면 저장할 때 사라진다. 저장하면 장르 목록을 새로 받아 편집기를 다시 그리기 때문이다.
const DEEP_KEY = "configGenres.deepOpen";

function loadDeep() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DEEP_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

const deepOpen = ref(loadDeep());

export const isDeepOpen = (id) => deepOpen.value.has(id);

export function toggleDeepOpen(id) {
  const next = new Set(deepOpen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  deepOpen.value = next;
  try {
    localStorage.setItem(DEEP_KEY, JSON.stringify([...next]));
  } catch {
    // 사생활 보호 모드 등. 이번 세션 동안만 펼쳐 둔다
  }
}
