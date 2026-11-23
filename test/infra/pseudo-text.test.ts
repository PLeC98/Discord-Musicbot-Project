// src/infra/pseudo-text.ts: 테스트 언어. 한글 음절만 영문자로 바꾸고 글자 수를 지키며, 두 번 바꿔도 같다

import { test } from "node:test";
import assert from "node:assert/strict";
import { pseudoString, pseudoText } from "../../src/infra/pseudo-text.ts";

test("한글 음절을 초성의 영문자로 바꾸고 나머지 글자는 그대로 둔다", () => {
  assert.equal(pseudoString("가나다 ABC 123!"), "gnd ABC 123!");
  assert.equal(pseudoString("힣"), "h");
  assert.equal(pseudoString("**굵게** `코드`"), "**gg** `kd`");
});

test("글자 수가 그대로이고 ASCII만 남으며, 두 번 바꿔도 같다", () => {
  const text = "대기열이 가득 찼어요! 🎵";
  const once = pseudoString(text);
  assert.equal([...once].length, [...text].length);
  assert.doesNotMatch(once, /[가-힣]/);
  assert.equal(pseudoString(once), once);
});

test("pseudoText: 문자열, 배열, 일반 객체는 안쪽까지, 함수는 돌려준 값을, 그 밖의 값은 그대로", () => {
  class Box {
    label = "상자";
  }
  const box = new Box();
  const wrapped = pseudoText({ title: "제목", list: ["하나"], make: (n: number) => ({ title: `${n}곡`, icon: "done" }), box, read: (s: string) => s }, new Set(["read"]));
  assert.equal(wrapped.title, "jm");
  assert.deepEqual(wrapped.list, ["hn"]);
  assert.deepEqual(wrapped.make(3), { title: "3g", icon: "done" });
  assert.equal(wrapped.box, box);
  assert.equal(wrapped.read("검색어"), "검색어", "skip에 든 경로는 감싸지 않는다");
});
