// dashboard/src/login-background/pick.ts · adapt.ts — 로그인 배경 영상을 무엇으로 틀지(코덱 · 해상도 상한 · 내려갈 차례)와 조절의 좋음 판정

import { test } from "node:test";
import assert from "node:assert/strict";
import { blurCapped, ladderOf, neededShort, rungsOf, type Rung, type Verdict } from "../../../dashboard/src/login-background/pick.ts";
import { goodOf } from "../../../dashboard/src/login-background/adapt.ts";
import type { LoginBackgroundStream } from "../../../src/dashboard/contract/login-background.ts";

const STREAMS: LoginBackgroundStream[] = [
  {
    codec: "av1",
    url: "/av1.m3u8",
    rungs: [
      { width: 1920, height: 1080, codecs: "av01.0.08M.10", bandwidth: 9e6, frameRate: 30 },
      { width: 3840, height: 2160, codecs: "av01.0.12M.10", bandwidth: 22e6, frameRate: 30 },
    ],
  },
  {
    codec: "vp9",
    url: "/vp9.m3u8",
    rungs: [
      { width: 1920, height: 1080, codecs: "vp09.00.40.08", bandwidth: 8e6, frameRate: 30 },
      { width: 3840, height: 2160, codecs: "vp09.00.51.08", bandwidth: 20e6, frameRate: 30 },
    ],
  },
  { codec: "h264", url: "/h264.m3u8", rungs: [{ width: 1280, height: 720, codecs: "avc1.64001f", bandwidth: 2.4e6, frameRate: 30 }] },
];
const RUNGS = rungsOf(STREAMS);
const rung = (codec: string, short: number) => RUNGS.find((one) => one.codec === codec && Math.min(one.width, one.height) === short)!;
/** 판정: 기기가 풀 수 있는 것 · 전력 효율(○) */
function verdicts(table: Record<string, Partial<Verdict>>): Map<Rung, Verdict> {
  return new Map(RUNGS.map((one) => [one, { supported: false, smooth: false, powerEfficient: false, ...table[`${one.codec}-${Math.min(one.width, one.height)}`] }]));
}
const ok = { supported: true, smooth: true, powerEfficient: true };
const slow = { supported: true, smooth: false, powerEfficient: false };
const plain = { reduced: false, capFhd: false };

test("단계는 코덱마다 목록의 판정 꼴(MIME · 2초 최대)로 풀어 둔다", () => {
  assert.equal(RUNGS.length, 5);
  assert.deepEqual([rung("av1", 2160).type, rung("av1", 2160).bandwidth], ['video/mp4; codecs="av01.0.12M.10"', 22e6]);
});

test("필요한 세로 이상의 가장 낮은 ○ 해상도를 먼저, 그 해상도에서 AV1 · VP9 · H.264 차례로 코덱. 그 아래로 효과 · 해상도 · H.264 · 정지 그림", () => {
  const all = verdicts({ "av1-1080": ok, "av1-2160": ok, "vp9-1080": ok, "vp9-2160": ok, "h264-720": ok });
  assert.deepEqual(ladderOf(RUNGS, all, 1080, plain), [
    { codec: "av1", cap: 1080, effect: "full" },
    { codec: "av1", cap: 1080, effect: "cover" },
    { codec: "av1", cap: 1080, effect: "fixed" },
    { codec: "h264", cap: null, effect: "fixed" },
    { codec: null, cap: null, effect: "fixed" },
  ]);
  const big = ladderOf(RUNGS, all, 2160, plain);
  assert.deepEqual(big.slice(0, 4), [
    { codec: "av1", cap: null, effect: "full" },
    { codec: "av1", cap: null, effect: "cover" },
    { codec: "av1", cap: null, effect: "fixed" },
    { codec: "av1", cap: 1080, effect: "fixed" },
  ]);
});

test("AV1 이 ○ 가 아니면 VP9, AV1 · VP9 에 ○ 가 없으면 H.264 720p, 풀 수 있는 것이 없으면 정지 그림", () => {
  assert.equal(ladderOf(RUNGS, verdicts({ "av1-1080": slow, "av1-2160": slow, "vp9-1080": ok, "vp9-2160": ok, "h264-720": ok }), 1080, plain)[0].codec, "vp9");
  assert.equal(ladderOf(RUNGS, verdicts({ "av1-1080": slow, "vp9-1080": slow, "h264-720": ok }), 1080, plain)[0].codec, "h264");
  assert.deepEqual(ladderOf(RUNGS, verdicts({}), 1080, plain), [{ codec: null, cap: null, effect: "fixed" }]);
  assert.deepEqual(ladderOf(RUNGS, verdicts({ "av1-1080": ok }), 1080, { reduced: true, capFhd: false }), [{ codec: null, cap: null, effect: "fixed" }], "움직임 줄이기");
});

test("흐림이 강하면 1080p 까지만(4K 가 목록에 있어도 상한을 건다)", () => {
  const all = verdicts({ "av1-1080": ok, "av1-2160": ok, "h264-720": ok });
  const steps = ladderOf(RUNGS, all, 2160, { reduced: false, capFhd: true });
  assert.deepEqual(steps[0], { codec: "av1", cap: 1080, effect: "full" });
  assert.ok(steps.every((one) => one.cap === null || one.cap <= 1080 || one.codec === null));
  // 흐림 반지름이 화면 높이의 0.23% 이상이면(가로 화면, 기본 흐림 0.5% 는 그보다 크다)
  assert.equal(blurCapped({ width: 1920, height: 1080 }, 0.5), true);
  assert.equal(blurCapped({ width: 1920, height: 1080 }, 0.1), false);
});

test("필요한 짧은 변: 틀 × 배율을 영상 비율로 꽉 채운 크기(세로 화면은 크다), 흐림이 강하면 1080 까지", () => {
  assert.equal(neededShort({ width: 1920, height: 1080, dpr: 1 }, 16 / 9, 0), 1080);
  assert.equal(neededShort({ width: 1920, height: 1080, dpr: 2 }, 16 / 9, 0), 2160);
  // 세로 휴대폰(393 × 852, 배율 3): 16:9 영상을 꽉 채우면 세로 2556
  assert.equal(neededShort({ width: 393, height: 852, dpr: 3 }, 16 / 9, 0), 2556);
  assert.equal(neededShort({ width: 1920, height: 1080, dpr: 2 }, 16 / 9, 0.5), 1080);
});

test("조절의 좋음: 최근 창을 합쳐 낸 장면이 초당 장면 수의 85% 이상이고 버린 장면이 2% 이하", () => {
  assert.equal(goodOf([{ rate: 29.8, dropped: 1, decoded: 120 }], 30), true);
  assert.equal(goodOf([{ rate: 24, dropped: 0, decoded: 120 }], 30), false, "낸 장면이 모자람");
  assert.equal(
    goodOf(
      [
        { rate: 30, dropped: 2, decoded: 120 },
        { rate: 30, dropped: 2, decoded: 120 },
        { rate: 30, dropped: 2, decoded: 120 },
      ],
      30,
    ),
    true,
    "창마다 1.7%",
  );
  assert.equal(
    goodOf(
      [
        { rate: 30, dropped: 4, decoded: 120 },
        { rate: 30, dropped: 4, decoded: 120 },
      ],
      30,
    ),
    false,
    "3.3%",
  );
});
