// 채널 판정. 디스코드 채널 종류 가운데 글을 보낼 수 있는 것만 골라낸다.

/** 글을 보낼 수 있는 채널. 가짜 채널도 같은 칸(send)으로 가른다 */
function canSend<C>(channel: C | null | undefined): channel is Extract<C, { send: unknown }> {
  return typeof (channel as { send?: unknown } | null | undefined)?.send === "function";
}

export { canSend };
