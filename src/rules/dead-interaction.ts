// 판정: 디스코드 상호작용이 이미 죽었나. 답: true | false.

// 안내를 보내지 않을 상호작용. 10062 는 토큰이 죽어 reply 도 followUp 도 같은 오류로 끝나고,
// 40060 은 이 상호작용에 이미 답한 곳이 있다(같은 토큰의 다른 실행 · 앞선 응답). 둘 다 안내를 더 보내면 오류나 중복이 된다.
function isDeadInteraction(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err.code === 10062 || err.code === 40060);
}

export { isDeadInteraction };
