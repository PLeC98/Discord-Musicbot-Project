// 대기열에 더 넣을 수 있는 곡 수. 곡 담기 · 디스코드 "더 넣기" 메뉴 · 대시보드 "더 넣기"가 같이 쓴다

/** 상한까지 대기열에 더 넣을 수 있는 곡 수(대기열 곡 수로). 현재곡은 세지 않는다. max 가 0 이면 끔 */
const roomAfter = (queued: number, max: number) => (max > 0 ? Math.max(0, max - queued) : Infinity);

/** 곡 묶음을 넣을 자리(대기열 곡 수 · 지금 곡이 있는지로). 지금 곡이 없으면 첫 곡은 대기열을 거치지 않고 바로 튼다 */
const roomWith = (queued: number, playing: boolean, max: number) => roomAfter(queued, max) + (playing ? 0 : 1);

/** 상한까지 대기열에 더 넣을 수 있는 곡 수 */
const roomLeft = (player: { queue: readonly unknown[] }, max: number) => roomAfter(player.queue.length, max);

/** 곡 묶음을 넣을 자리 */
const roomFor = (player: { queue: readonly unknown[]; currentTrack: unknown }, max: number) => roomWith(player.queue.length, Boolean(player.currentTrack), max);

export { roomAfter, roomWith, roomLeft, roomFor };
