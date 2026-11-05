// src/rules/query-cover.ts: 연령 인증이 걸린 검색어를 스포티파이 1위 곡의 것으로 볼지

import { test } from "node:test";
import assert from "node:assert/strict";
import { queryNamesTrack } from "../../src/rules/query-cover.ts";

test("제목(과 가수)이 검색어에 들어 있고 검색어의 절반 이상이면 그 곡이다. 대소문자, 띄어쓰기, 문장 부호, 기호는 보지 않는다", () => {
  assert.equal(queryNamesTrack("閃光 [Alexandros]", { title: "閃光", artist: "[Alexandros]" }), true);
  assert.equal(queryNamesTrack("love shot exo", { title: "Love Shot", artist: "EXO" }), true);
  assert.equal(queryNamesTrack("Janice STFU", { title: "Janice STFU", artist: "Drake" }), true, "제목만");
  assert.equal(queryNamesTrack("TT", { title: "TT", artist: "TWICE" }), true, "짧은 제목도 검색어 전체면");
  assert.equal(queryNamesTrack("Marry Fuck Kill The Bombpops", { title: "Marry. Fuck. Kill.", artist: "The Bombpops" }), true);
});

test("제목이 검색어에 없거나, 긴 검색어 안에 우연히 들었으면 아니다", () => {
  assert.equal(queryNamesTrack("rsewjhguioedrtuidu", { title: "Rush", artist: "Troye Sivan" }), false, "제목이 없다");
  assert.equal(queryNamesTrack("asdkfjlovezxcvqwer", { title: "Love", artist: "Kendrick Lamar" }), false, "짧은 제목이 우연히");
  assert.equal(queryNamesTrack("키보드 테스트 사랑 입력테스트 마이크", { title: "사랑", artist: "a" }), false, "한 글자 가수로 채우지 못한다");
  assert.equal(queryNamesTrack("아무 노래", { title: "", artist: "가수" }), false, "빈 제목");
  assert.equal(queryNamesTrack("lemon 요네즈 켄시 노래 좀 틀어줘", { title: "Lemon", artist: "Kenshi Yonezu" }), false, "말이 길면 놓친다");
});

test('가수가 여럿이면(스포티파이의 "가수1, 가수2") 검색어에 든 가수만 센다', () => {
  assert.equal(queryNamesTrack("Bad Angel LISA", { title: "Bad Angel", artist: "Anyma, LISA" }), true);
  assert.equal(queryNamesTrack("Bad Angel Anyma LISA", { title: "Bad Angel", artist: "Anyma, LISA" }), true);
  assert.equal(queryNamesTrack("Bad Angel 아무 글자나 길게 이어 쳤어요", { title: "Bad Angel", artist: "Anyma, LISA" }), false);
});
