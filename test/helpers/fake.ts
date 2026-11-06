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

// 쉬는 재생 단계. 읽기만 한다(진짜 PlaybackState 를 불러오면 로거, 설정이 테스트 준비보다 먼저 열린다)
const idleLifecycle = () => ({ phase: "idle", ending: false, starting: false, parked: false, disposed: false });

/** 진짜 플레이어에 있는 키만 받는 모양. 플레이어에서 사라진 이름을 가짜에 남기면 그 키가 never 가 되어 타입 검사가 걸린다 */
type PlayerKeys<X> = { [K in keyof X]: K extends keyof Player ? unknown : never };

/**
 * 가짜 플레이어. fields 는 진짜 플레이어의 키만, extras 는 테스트만 쓰는 필드(호출 기록 등).
 * fields 의 메서드 안에서 this 는 fields 만 본다. 테스트만 쓰는 값을 메서드가 읽으려면 바깥 변수로 둔다.
 * 재생 단계(lifecycle)를 주지 않았으면 쉬는 단계를 붙인다(실패로 멈춰 뒀나, 여는 중인가를 여러 곳이 본다). 받은 객체에 붙이므로 게터는 그대로다
 */
const fakePlayer = <X extends PlayerKeys<X>, E extends object = Record<never, never>>(fields: X, extras?: E) => {
  if (extras) Object.assign(fields, extras);
  if (!("lifecycle" in fields)) Object.assign(fields, { lifecycle: idleLifecycle() });
  return fields as unknown as Player & E;
};

/** 가짜 봇 문맥(src/app/bot-context). 테스트가 읽는 필드만 채운다. 플레이어, 명령은 없으면 빈 목록, 자리 지킴이는 아무것도 안 하는 것 */
function fakeBot(partial: { client?: object; players?: Map<string, unknown>; panels?: object; commands?: Map<string, unknown>; stay?: object } = {}): BotContext {
  const stay = { boot: async () => {}, attempt: async () => true, onDisposed() {}, wake() {}, onGuildAvailable() {}, onChannelDeleted() {}, stop() {} };
  return fake<BotContext>({ client: {}, players: new Map(), commands: new Map(), stay, ...partial });
}

export { fake, fakeWith, fakePlayer, fakeBot };
