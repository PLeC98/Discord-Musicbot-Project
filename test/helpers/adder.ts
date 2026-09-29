// 곡 담기(usecases/addTracks 의 queueTracks)를 시험의 가짜로 바꾼다. 한 파일에 세계(클라이언트)가 여럿이라 클라이언트마다 따로 둔다.
// 가짜를 두지 않은 클라이언트는 진짜로 담는다

import * as addTracks from "../../src/usecases/addTracks.ts";

type Adder = typeof addTracks.queueTracks;

const fakes = new WeakMap<object, Adder>();
addTracks.useAdder((client, ...rest) => (fakes.get(client) ?? addTracks.queueTracks)(client, ...rest));

/** 이 클라이언트의 곡 담기를 가짜로. 가짜는 시험이 보는 칸만 채운 결과를 돌려줘도 된다 */
function fakeAdder(client: object, adder: (...args: Parameters<Adder>) => Promise<unknown>) {
  fakes.set(client, adder as Adder);
}

export { fakeAdder };
