// 시험이 읽는 칸만 채운 가짜를, 받는 쪽이 바라는 타입으로 본다.
// 가짜는 만드는 자리에서 한 번 이것을 거친다. 형 변환이 시험 곳곳에 흩어지지 않게.
//
//   const player = fake<SkipHost>({ currentTrack, paused: false, … });

import type { MusicPlayer } from "../../src/player/Player.ts";

function fake<T>(partial: object): T {
  return partial as T;
}

/** 가짜 플레이어. 플레이어의 칸은 플레이어 타입으로, 시험만 쓰는 칸(calls 등)은 그대로 */
function fakePlayer<X extends object>(partial: X) {
  return partial as unknown as MusicPlayer & Omit<X, keyof MusicPlayer>;
}

export { fake, fakePlayer };
