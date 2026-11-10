// dashboard/src/utils/row-keys.ts, presence-rows.ts, genre-rows.ts: 저장, 되돌리기로 행을 다시 만들 때 지금 행의 key 를 물려준다(선택한 카드가 바뀌지 않게)

import { test } from "node:test";
import assert from "node:assert/strict";
import { keysFrom } from "../../../dashboard/src/utils/row-keys.ts";
import { toSpecial, toMessages } from "../../../dashboard/src/utils/presence-rows.ts";
import { toRows } from "../../../dashboard/src/utils/genre-rows.ts";

test("이름이 같은 행 먼저, 없으면 같은 자리의 행, 없으면 새 key. 한 key 는 한 번만", () => {
  let next = 100;
  const fresh = () => ++next;
  const before = [
    { key: 1, name: "a" },
    { key: 2, name: "b 고친 이름" },
    { key: 3, name: "c" },
  ];
  // b 를 고쳤다 되돌렸다(이름이 다르다): 같은 자리의 key. 새로 생긴 d 는 새 key
  assert.deepEqual(keysFrom(["a", "b", "c", "d"], before, fresh), [1, 2, 3, 101]);
  // 순서를 바꿨다: 이름으로 따라간다
  assert.deepEqual(keysFrom(["c", "a"], before, fresh), [3, 1]);
  // 이름이 앞 행의 것과 같으면 그 행이 먼저 가져가고, 자리로 줄 key 가 이미 쓰였으면 새 key
  assert.deepEqual(keysFrom(["x", "a"], [{ key: 1, name: "a" }], fresh), [102, 1]);
  assert.deepEqual(keysFrom([" a "], [{ key: 1, name: "a" }], fresh), [1], "앞뒤 공백은 같은 이름");
});

test("상태 문구: 다시 만들면 항목과 그 문구가 key 를 물려받는다", () => {
  const first = toSpecial({ 크리스마스: { date: "12-24 ~ 12-26", messages: ["하나", "둘"] }, 심야: { time: "22:00 ~ 06:00", messages: ["밤"] } });
  const again = toSpecial({ 크리스마스: { date: "12-24 ~ 12-25", messages: ["하나", "둘"] }, 심야: { time: "22:00 ~ 06:00", messages: ["밤"] } }, first);
  assert.deepEqual(
    again.map((one) => one.key),
    first.map((one) => one.key),
  );
  assert.deepEqual(
    again[0].messages.map((one) => one.key),
    first[0].messages.map((one) => one.key),
  );
  assert.equal(again[0].date, "12-24 ~ 12-25");
  const plain = toMessages(["a"], toMessages(["b"]));
  assert.equal(plain[0].text, "a");
});

test("장르: 다시 만들면 이름이 같은 장르가 key 를 물려받는다", () => {
  const first = toRows({ pop: { label: "팝" }, rock: { label: "록" } });
  const again = toRows({ rock: { label: "록" }, pop: { label: "팝!" } }, first);
  assert.deepEqual(
    again.map((one) => [one.name, one.key]),
    [
      ["rock", first[1].key],
      ["pop", first[0].key],
    ],
  );
});
