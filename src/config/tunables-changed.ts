// 운영 조절값이 바뀌었다는 알림. 기동 때 한 번 만들어 두는 것(요청 제한기 · 하트비트 · 캐시 정리 타이머)이 듣고 다시 만든다.
// 저장(store/tunables)이 설정 객체를 고친 뒤 부른다. 듣는 쪽은 자기 값이 바뀌었는지 스스로 본다(안 바뀌었으면 그대로 둔다).
// 로그 모듈은 부르지 않는다(로그 싱크도 듣는 쪽이라 서로 부르게 된다). 실패는 돌려주고 부른 쪽이 적는다

const listeners = new Set<() => void>();

/** 바뀔 때마다 부른다. 떼는 함수를 돌려준다 */
function onTunablesChanged(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** 알린다. 듣는 쪽 하나가 던져도 나머지는 받는다. 던진 것을 돌려준다 */
function tunablesChanged(): unknown[] {
  const failed: unknown[] = [];
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      failed.push(error);
    }
  }
  return failed;
}

export { onTunablesChanged, tunablesChanged };
