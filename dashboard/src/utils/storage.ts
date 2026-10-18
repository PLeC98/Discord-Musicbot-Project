// 브라우저 저장소(localStorage). 사생활 보호 창 · 막아 둔 브라우저에서는 읽기 · 쓰기가 던진다.
// 기억하지 못해도 화면은 돌아야 하므로 실패는 삼키고 기본값을 쓴다

/** 저장된 글. 없거나 못 읽으면 null */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 저장한다. 못 쓰면 이번만 기억하지 못한다 */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 기억하지 못해도 선택하는 데는 지장이 없다
  }
}
