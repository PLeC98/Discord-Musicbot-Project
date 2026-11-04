// src/rules/app-emoji-token.ts: 설정에 적힌 앱 이모지 토큰을 찾고 보낼 글로 바꾼다

import { test } from "node:test";
import assert from "node:assert/strict";
import { componentEmojiOf, find, toDiscordText, tokensIn, type EmojiBook } from "../../src/rules/app-emoji-token.ts";

const PARTY = { id: "111111111111111111", name: "party", animated: false };
const SPIN = { id: "222222222222222222", name: "spin", animated: true };
const PLAY = { id: "333333333333333333", name: "play", animated: false };
const book: EmojiBook = {
  emojis: [PARTY, SPIN, PLAY],
  retired: { voice: { unicode: "🎧" }, old_play: { renamed: "play" } },
  iconUnicode: (name) => (name === "pause" ? "⏸️" : undefined),
};

test("id 가 먼저: 이름이 바뀐 이모지도 찾고, 같은 이름의 다른 이모지로 바뀌지 않는다", () => {
  assert.deepEqual(find(book, "celebrate", PARTY.id), { emoji: PARTY }, "개발자 포털에서 이름만 바꿨다");
  assert.deepEqual(find(book, "party", "999999999999999999"), { emoji: PARTY }, "다시 올려 id 가 바뀌었다(아이콘), 다른 봇의 장르 파일");
  assert.deepEqual(
    find(
      {
        emojis: [
          { ...PARTY, name: "old" },
          { id: "444444444444444444", name: "party", animated: false },
        ],
      },
      "party",
      PARTY.id,
    ),
    { emoji: { ...PARTY, name: "old" } },
  );
});

test("옛 이름은 새 이름이나 빠진 아이콘의 유니코드로, 지금 아이콘 이름은 그 유니코드로, 그 밖은 없음", () => {
  assert.deepEqual(find(book, "old_play", "999999999999999999"), { emoji: PLAY });
  assert.deepEqual(find(book, "voice", "999999999999999999"), { unicode: "🎧" });
  assert.deepEqual(find(book, "pause", "999999999999999999"), { unicode: "⏸️" }, "동기화 전, 실패");
  assert.equal(find(book, "gone", "999999999999999999"), null);
  assert.equal(find({ emojis: [] }, "pause", "999999999999999999"), null, "대시보드는 유니코드 없이 쓴다");
});

test("보낼 글: 토큰을 지금 토큰으로(움직임은 찾은 이모지 것), 대신 쓸 유니코드로, 없으면 뺀다. 다른 글은 그대로", () => {
  const text = `<:party:${PARTY.id}> 재생 중 <:spin:${SPIN.id}><:voice:999999999999999999><:gone:999999999999999999> 12:30:45 :party: <:x:1>`;
  assert.equal(toDiscordText(text, book), `<:party:${PARTY.id}> 재생 중 <a:spin:${SPIN.id}>🎧 12:30:45 :party: <:x:1>`);
});

test("토큰 자리", () => {
  const text = `가<:party:${PARTY.id}>나`;
  assert.deepEqual(
    tokensIn(text, book).map(({ from, to, name, found }) => [from, to, name, found !== null]),
    [[1, 1 + `<:party:${PARTY.id}>`.length, "party", true]],
  );
});

test("컴포넌트 이모지: 토큰이면 찾은 것, 유니코드면 그대로, 비었거나 찾지 못하면 null", () => {
  assert.deepEqual(componentEmojiOf(`<a:spin:${SPIN.id}>`, book), SPIN);
  assert.deepEqual(componentEmojiOf(`<:voice:999999999999999999>`, book), { name: "🎧" });
  assert.deepEqual(componentEmojiOf("🎸", book), { name: "🎸" });
  assert.equal(componentEmojiOf("", book), null);
  assert.equal(componentEmojiOf(`<:gone:999999999999999999>`, book), null);
});
