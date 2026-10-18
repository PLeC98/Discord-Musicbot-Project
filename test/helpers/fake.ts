// 테스트가 읽는 필드만 채운 가짜를, 받는 쪽이 바라는 타입으로 본다.
// 가짜는 만드는 곳에서 한 번 이것을 거친다. 형 변환이 테스트 곳곳에 흩어지지 않게.
//
//   const player = fake<SkipHost>({ currentTrack, paused: false, … });

import type { Player } from "../../src/player/player.ts";
import type { BotContext } from "../../src/app/bot-context.ts";

function fake<T>(partial: object): T {
  return partial as T;
}

/**
 * 진짜 타입의 필드는 그 타입으로, 테스트만 쓰는 필드(calls 등)는 그대로 읽는 가짜. 받을 타입을 먼저 정한다
 *   const interaction = fakeWith<RepliableInteraction>()({ calls, editReply … });
 */
function fakeWith<T>() {
  return <X extends object>(partial: X) => partial as unknown as T & Omit<X, keyof T>;
}

/** 가짜 플레이어 */
const fakePlayer = fakeWith<Player>();

/** 가짜 봇 문맥(src/app/bot-context). 테스트가 읽는 필드만 채운다. 플레이어 · 명령은 없으면 빈 목록 */
function fakeBot(partial: { client?: object; players?: Map<string, unknown>; panels?: object; commands?: Map<string, unknown> } = {}): BotContext {
  return fake<BotContext>({ client: {}, players: new Map(), commands: new Map(), ...partial });
}

export { fake, fakeWith, fakePlayer, fakeBot };
