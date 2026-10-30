// src/store/stay-seats.ts: 24/7 자리. 메모리가 정본이고 DB 는 다시 시작할 때 읽는 사본이다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import * as seats from "../../src/store/stay-seats.ts";

const store = openTempStore("stay-seats-");
after(() => store.close());

test("적으면 메모리와 DB 에 함께, 옮기면 켠 사람은 그대로, 지우면 둘 다에서 빠지고 다시 읽어도 같다", () => {
  seats.set("g1", "vc1", "u1");
  seats.set("g2", "vc9", "u2");
  seats.set("g1", "vc2");
  assert.equal(seats.seatOf("g1")?.channelId, "vc2");
  assert.equal(seats.seatOf("g1")?.setBy, "u1", "따라 옮겨도 켠 사람은 남는다");

  assert.equal(seats.clear("g2"), true);
  assert.equal(seats.clear("g2"), false, "없으면 false");

  seats.load();
  assert.deepEqual(
    seats.all().map(([guildId, seat]) => [guildId, seat.channelId]),
    [["g1", "vc2"]],
  );
  assert.equal(seats.seatOf("g3"), null);
});
