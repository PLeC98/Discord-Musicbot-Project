// dashboard/src/utils/turn.ts: 편집 창의 회전, 반전. 돌린 이미지 위 영역과 원본 위 영역을 오가는 계산

import { test } from "node:test";
import assert from "node:assert/strict";
import { fromSource, mirror, toSource, turnedSize, turnRight, type Rotation, type Turn } from "../../../dashboard/src/utils/turn.ts";

const NATURAL = { width: 400, height: 250 };
const TURNS: Turn[] = ([0, 90, 180, 270] as Rotation[]).flatMap((rotate) => [false, true].map((flip) => ({ rotate, flip })));
/** 돌린 이미지 안의 가로가 긴 영역(가장자리에 붙지 않게) */
const rectIn = (turn: Turn) => {
  const { width, height } = turnedSize(NATURAL, turn);
  return { x: width * 0.1, y: height * 0.2, w: width * 0.5, h: height * 0.3 };
};

test("여덟 가지 모두 원본으로 갔다 돌아오면 같다", () => {
  for (const turn of TURNS) {
    const rect = rectIn(turn);
    assert.deepEqual(fromSource(toSource(rect, NATURAL, turn), NATURAL, turn), rect, JSON.stringify(turn));
  }
});

test("원본 위 영역은 원본 안에 있다", () => {
  for (const turn of TURNS) {
    const source = toSource(rectIn(turn), NATURAL, turn);
    assert.ok(source.x >= 0 && source.y >= 0 && source.x + source.w <= NATURAL.width + 1e-9 && source.y + source.h <= NATURAL.height + 1e-9, JSON.stringify({ turn, source }));
  }
});

test("보이는 이미지를 돌리거나 뒤집어도 영역은 원본의 같은 곳을 가리킨다", () => {
  for (const turn of TURNS) {
    const rect = rectIn(turn);
    const before = toSource(rect, NATURAL, turn);
    const right = turnRight(NATURAL, turn, rect);
    assert.deepEqual(toSource(right.rect, NATURAL, right.turn), before, `회전 ${JSON.stringify(turn)}`);
    const flipped = mirror(NATURAL, turn, rect);
    assert.deepEqual(toSource(flipped.rect, NATURAL, flipped.turn), before, `반전 ${JSON.stringify(turn)}`);
  }
});

test("네 번 돌리면 처음으로", () => {
  for (const start of TURNS) {
    let now = { turn: start, rect: rectIn(start) };
    for (let i = 0; i < 4; i++) now = turnRight(NATURAL, now.turn, now.rect);
    assert.deepEqual(now, { turn: start, rect: rectIn(start) });
  }
});

test("앱 이모지 봇 쪽과 같은 되돌리기(90도: 돌린 이미지의 왼쪽 위 정사각형은 원본의 왼쪽 아래)", () => {
  // src/dashboard/app-emoji-image.ts 의 regionOf: 90 → [y, height - x - side]
  assert.deepEqual(toSource({ x: 0, y: 0, w: 100, h: 100 }, NATURAL, { rotate: 90, flip: false }), { x: 0, y: 150, w: 100, h: 100 });
});
