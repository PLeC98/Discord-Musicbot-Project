"use strict";

// 판정: 디스코드 상호작용이 이미 죽었나. 답: true | false.

// 상호작용 토큰이 죽은 경우. 응답 경로 자체가 닫혀서 reply도 followUp도 다시 같은 오류다.
// 오류 안내를 시도하는 것이 곧 두 번째 오류가 된다.
function isDeadInteraction(err) {
  return !!err && (err.code === 10062 || err.code === 40060);
}

module.exports = { isDeadInteraction };
