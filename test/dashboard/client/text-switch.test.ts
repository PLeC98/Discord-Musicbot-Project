// dashboard/src/text/index.ts: 화면 문구를 그 자리에서 다른 언어로 바꾼다. 모듈을 가리켜 둔 곳(const T = text.shell)은 같은 그릇이라 바뀐 글자를 보고,
// 화면도 쓰는 봇 문구(text.bot)와 그 오류 안내도 함께 바뀐다. 기준 언어로 돌아오면 처음 글자로 돌아온다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { text, textLanguage, useTextLanguage } from "../../../dashboard/src/text/index.ts";
import { TEST_LANGUAGE } from "../../../src/rules/languages.ts";

after(() => useTextLanguage("ko"));

const HANGUL = /[가-힣]/;
// 화면의 Vue(테스트 폴더에는 설치되어 있지 않다)
const { isReactive } = (await import(new URL("../../../dashboard/node_modules/vue/index.mjs", import.meta.url).href)) as { isReactive: (value: unknown) => boolean };

test("모듈을 가리켜 둔 곳은 바뀐 글자를 보고, 봇 문구와 오류 안내도 바뀐다. 기준 언어로 돌아오면 처음 그대로", async () => {
  const T = text.shell;
  const B = text.bot.labels;
  const before = { title: T.serverList, song: B.songTitle(null), notice: text.bot.errors.notice("no-song").title };
  assert.ok(HANGUL.test(before.title) && HANGUL.test(before.song) && HANGUL.test(before.notice));
  assert.ok(isReactive(T) && isReactive(B), "모듈마다 반응형 그릇이라 화면이 다시 그린다");

  await useTextLanguage(TEST_LANGUAGE);
  assert.equal(textLanguage.value, TEST_LANGUAGE);
  assert.equal(text.shell, T, "같은 그릇");
  assert.doesNotMatch(T.serverList, HANGUL);
  assert.equal([...T.serverList].length, [...before.title].length, "테스트 언어는 글자 수가 같다");
  assert.doesNotMatch(B.songTitle(null), HANGUL);
  assert.doesNotMatch(text.bot.errors.notice("no-song").title, HANGUL);

  await useTextLanguage("ko");
  assert.deepEqual({ title: T.serverList, song: B.songTitle(null), notice: text.bot.errors.notice("no-song").title }, before);
});
