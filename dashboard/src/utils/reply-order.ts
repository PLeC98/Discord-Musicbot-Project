// 같은 것을 여러 길로 받을 때(3초 폴링과 스크롤, 필터링의 바로 받기가 겹친다) 답이 보낸 순서와 다르게 와도 최신 요청만 반영한다.
// 반영한 답보다 앞선 번호의 답은 성공, 실패 모두 버린다(늦게 온 실패가 새 값 위에 "받지 못함"을 띄우지 않게)

export function replyOrder() {
  let sent = 0;
  let shown = 0;
  let flying = 0;
  return {
    /** 진행 중인 요청이 있나(폴링은 건너뛴다) */
    busy: () => flying > 0,
    /** 보낼 때. 이 요청의 번호 */
    send: () => {
      flying++;
      return ++sent;
    },
    /** 답이 왔을 때(성공, 실패). 반영할 답이면 참. fits 가 거짓이면(보낸 뒤 쿼리가 바뀌었다) 반영하지 않고 반영한 것으로도 치지 않는다 */
    settle: (n: number, fits = true) => {
      flying--;
      if (!fits || n <= shown) return false;
      shown = n;
      return true;
    },
  };
}
