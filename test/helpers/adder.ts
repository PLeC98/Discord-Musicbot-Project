// 곡 담기(usecases/add-tracks 의 queueTracks)를 시험의 가짜로 바꾼다. 한 파일에 세계(봇 문맥)가 여럿이라 봇 문맥마다 따로 둔다.
// 가짜를 두지 않은 봇 문맥은 진짜로 담는다

import * as addTracks from "../../src/usecases/add-tracks.ts";

type Adder = typeof addTracks.queueTracks;

const fakes = new WeakMap<object, Adder>();
addTracks.useAdder((bot, ...rest) => (fakes.get(bot) ?? addTracks.queueTracks)(bot, ...rest));

/** 이 봇 문맥의 곡 담기를 가짜로. 가짜는 시험이 보는 칸만 채운 결과를 돌려줘도 된다 */
function fakeAdder(bot: object, adder: (...args: Parameters<Adder>) => Promise<unknown>) {
  fakes.set(bot, adder as Adder);
}

export { fakeAdder };
