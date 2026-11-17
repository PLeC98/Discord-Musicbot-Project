// 브라우저 저장소(localStorage, 탭을 닫으면 비는 sessionStorage). 사생활 보호 창, 막아 둔 브라우저에서는 읽기, 쓰기가 예외를 던진다.
// 기억하지 못해도 화면은 돌아야 하므로 실패는 삼키고 기본값을 쓴다

const area = (session: boolean) => (session ? sessionStorage : localStorage);

/** 저장된 글. 없거나 못 읽으면 null. session: 이 탭에서만(탭을 닫으면 빈다) */
export function readStored(key: string, session = false): string | null {
  try {
    return area(session).getItem(key);
  } catch {
    return null;
  }
}

/** 저장한다. 못 쓰면 이번만 기억하지 못한다. session: 이 탭에서만(탭을 닫으면 빈다) */
export function writeStored(key: string, value: string, session = false): void {
  try {
    area(session).setItem(key, value);
  } catch {
    // 기억하지 못할 뿐 화면은 그대로 돈다
  }
}
