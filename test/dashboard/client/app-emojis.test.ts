// dashboard/src/composables/app-emojis.ts: 입력란의 앱 이모지 바꾸기(저장 값의 토큰 ↔ 입력란의 문자)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appEmojis, fromChars, hasAppEmojiChar, hasMissing, toChars } from "../../../dashboard/src/composables/app-emojis.ts";

const PARTY = { id: "111111111111111111", name: "party", animated: false, icon: false, char: "\u{F0000}" };
const SPIN = { id: "222222222222222222", name: "spin", animated: true, icon: false, char: "\u{F0001}" };

beforeEach(() => (appEmojis.value = [PARTY, SPIN]));

test("토큰은 그 문자로, 문자는 지금 토큰으로. 오가도 같다", () => {
  const stored = `<:party:${PARTY.id}> 재생 중 <a:spin:${SPIN.id}>`;
  assert.equal(toChars(stored), `${PARTY.char} 재생 중 ${SPIN.char}`);
  assert.equal(fromChars(toChars(stored)), stored);
});

test("이름이 바뀌었거나 다시 올린 이모지는 찾은 것의 문자로, 입력란에서 나오면 지금 토큰으로", () => {
  assert.equal(fromChars(toChars(`<:celebrate:${PARTY.id}>`)), `<:party:${PARTY.id}>`);
  assert.equal(fromChars(toChars(`<:party:999999999999999999>`)), `<:party:${PARTY.id}>`);
});

test("찾지 못한 토큰은 글자 그대로, 보통 글과 다른 이모지는 그대로", () => {
  const text = "<:gone:999999999999999999> 12:30:45 :party: 😀";
  assert.equal(toChars(text), text);
  assert.equal(fromChars(text), text);
  assert.ok(hasMissing(text));
  assert.ok(!hasMissing(`<:party:${PARTY.id}>`));
});

test("앱 이모지 문자가 들었는가(복사, 잘라내기)", () => {
  assert.ok(hasAppEmojiChar(`가${PARTY.char}`));
  assert.ok(!hasAppEmojiChar("가😀"));
});
