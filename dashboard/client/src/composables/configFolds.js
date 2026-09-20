import { ref } from "vue";

// 자동재생 설정에서 접어 둔 카드. 장르와 그 안의 출처.
//
// 접은 것만 적는다. 새로 만든 장르·출처는 펼친 채로 나오고, 저장한 적 없는 것도 펼쳐진다.
// 자리(번호)로 기억하므로 순서를 바꾸거나 위엣것을 지우면 기억이 한 칸 밀린다.
// 이름으로 기억하면 이름을 고치는 순간 잃는 것은 마찬가지라 더 단순한 쪽을 골랐다.
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
