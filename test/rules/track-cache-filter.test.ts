// src/rules/track-cache-filter.ts: 캐시 DB 의 필터 식(DB Browser for SQLite 문법)을 읽고 비교한다
import test from "node:test";
import assert from "node:assert";
import { FILTER_MAX, REGEX_MAX, foldCase, matchFilter, matchWords, parseFilter, parseWords, readValue, type ColumnKind } from "../../src/rules/track-cache-filter.ts";

// 식을 읽어 값들 중 맞는 것만
function pick(kind: ColumnKind, expr: string, values: Array<string | number | null>) {
  const parsed = parseFilter(kind, expr);
  assert.ok(parsed?.ok, `읽혀야 한다: ${expr}`);
  return values.filter((value) => matchFilter(parsed.filter, value));
}

test("빈 식은 필터링하지 않는다", () => {
  assert.equal(parseFilter("text", "   "), null);
  assert.equal(parseWords(""), null);
});

test("그냥 쓰면 포함(대소문자 무시), % 는 아무 글자들, 다른 정규식 글자는 글자 그대로", () => {
  assert.deepEqual(pick("text", "yoa", ["YOASOBI", "Aimer", null]), ["YOASOBI"]);
  assert.deepEqual(pick("text", "a%r", ["Aimer", "ar", "abc"]), ["Aimer", "ar"]);
  assert.deepEqual(pick("text", "a.b", ["a.b", "axb"]), ["a.b"]);
});

test("한국어는 조합 중인 마지막 글자, 초성으로도 찾는다(서버 목록 검색과 같은 규칙)", () => {
  const titles = ["잔향산가", "밤을 달리다", "Lemon"];
  assert.deepEqual(pick("text", "잔햐", titles), ["잔향산가"], "마지막 글자는 조합 중");
  assert.deepEqual(pick("text", "ㅂㅇㄷ", titles), ["밤을 달리다"], "초성");
  assert.deepEqual(pick("text", "밤%다", titles), ["밤을 달리다"], "% 는 아무 글자들 그대로");
  const words = parseWords("ㅈㅎ lem");
  assert.ok(words?.ok);
  assert.equal(matchWords(words.words, ["잔향산가", "Lemon"]), true);
  assert.equal(matchWords(words.words, ["밤을 달리다", "Lemon"]), false);
});

test("=, <> 는 글자 열에서 그대로 견주고, ='', <>'' 는 빔, 빔 아님", () => {
  assert.deepEqual(pick("text", "=youtube", ["youtube", "YouTube", "youtube2"]), ["youtube"]);
  assert.deepEqual(pick("text", "<>youtube", ["youtube", "spotify", null]), ["spotify", null]);
  assert.deepEqual(pick("text", "=''", ["", null, "a"]), ["", null]);
  assert.deepEqual(pick("count", "<>''", [0, null, 3]), [0, 3]);
});

test("크기는 단위를 읽는다(없으면 바이트)", () => {
  assert.equal(readValue("bytes", "10MB")?.value, 10 * 1024 ** 2);
  assert.equal(readValue("bytes", "1.5 gb")?.value, Math.round(1.5 * 1024 ** 3));
  assert.equal(readValue("bytes", "512")?.value, 512);
  assert.equal(readValue("bytes", "10 메가"), null);
  assert.deepEqual(pick("bytes", ">5MB", [4 * 1024 ** 2, 6 * 1024 ** 2]), [6 * 1024 ** 2]);
  assert.deepEqual(pick("bytes", "1MB~2MB", [1024 ** 2, 1.5 * 1024 ** 2, 3 * 1024 ** 2]), [1024 ** 2, 1.5 * 1024 ** 2]);
});

test("길이는 분:초, 시:분:초, 초", () => {
  assert.equal(readValue("seconds", "3:30")?.value, 210);
  assert.equal(readValue("seconds", "1:02:03")?.value, 3723);
  assert.equal(readValue("seconds", "95")?.value, 95);
  assert.deepEqual(pick("seconds", ">=4:00", [239, 240, 300]), [240, 300]);
});

test("날짜 하나는 그날 하루: = 은 그날 안, > 는 그날 뒤, >= 는 그날부터, < 는 그날 전, <= 는 그날까지", () => {
  const day = new Date(2026, 9, 17).getTime();
  const [before, morning, night, after] = [day - 1, day + 9 * 3600_000, day + 23 * 3600_000, day + 24 * 3600_000];
  const all = [before, morning, night, after];
  assert.deepEqual(pick("time", "=2026-10-17", all), [morning, night]);
  assert.deepEqual(pick("time", ">2026-10-17", all), [after]);
  assert.deepEqual(pick("time", ">=2026-10-17", all), [morning, night, after]);
  assert.deepEqual(pick("time", "<2026-10-17", all), [before]);
  assert.deepEqual(pick("time", "<=2026-10-17", all), [before, morning, night]);
  assert.deepEqual(pick("time", "2026-10-17~2026-10-17", all), [morning, night]);
  assert.deepEqual(pick("time", ">=2026-10-17 12:00", all), [night, after]);
});

test("수 열에 읽을 수 없는 값, 글자 열에 크기 견주기는 bad-filter", () => {
  assert.deepEqual(parseFilter("count", ">many"), { ok: false, code: "bad-filter" });
  assert.deepEqual(parseFilter("text", ">3"), { ok: false, code: "bad-filter" });
  assert.deepEqual(parseFilter("time", "2026-13-40~x"), { ok: false, code: "bad-filter" });
});

test("정규식: /…/ 는 대소문자 무시, \\/ 로 / 를 쓴다", () => {
  assert.deepEqual(pick("text", "/^yt:/", ["yt:abc", "sc:yt:"]), ["yt:abc"]);
  assert.deepEqual(pick("text", "/watch\\/x/", ["a/watch/x", "watchx"]), ["a/watch/x"]);
});

test("정규식: 길이 상한, 겹친 반복, 문법 오류는 받지 않는다", () => {
  assert.deepEqual(parseFilter("text", `/${"a".repeat(REGEX_MAX + 1)}/`), { ok: false, code: "regex-too-long", max: REGEX_MAX });
  for (const bad of ["/(a+)+/", "/(a*)*b/", "/(\\w+){2,}/", "/(x{1,})+/"]) assert.deepEqual(parseFilter("text", bad), { ok: false, code: "unsafe-regex" }, bad);
  assert.deepEqual(parseFilter("text", "/(a/"), { ok: false, code: "bad-filter" });
  assert.ok(parseFilter("text", "/(ab)+c/")?.ok, "반복이 겹치지 않으면 받는다");
});

test("식 길이 상한", () => {
  assert.deepEqual(parseFilter("text", "x".repeat(FILTER_MAX + 1)), { ok: false, code: "filter-too-long", max: FILTER_MAX });
  assert.deepEqual(parseWords("x".repeat(FILTER_MAX + 1)), { ok: false, code: "filter-too-long", max: FILTER_MAX });
});

test("모든 열에서: 낱말마다 어느 열에든 들어간 행", () => {
  const words = parseWords("yoasobi  idol");
  assert.ok(words?.ok);
  assert.equal(matchWords(words.words, ["YOASOBI", "Idol (アイドル)", null]), true);
  assert.equal(matchWords(words.words, ["YOASOBI", "夜に駆ける", 12]), false);
});

// %를 정규식(.*)으로 바꾸면 a%a%a%a%a%a%b가 60자 제목에서 3초 넘게 걸렸다. 조각을 순서대로 찾아 소요 시간이 글자 수에 비례한다
test("% 식은 조각을 순서대로 찾는다. 조각이 많고 맞지 않아도 곧바로 끝난다", () => {
  const expr = `${Array(40).fill("a").join("%")}%b`;
  const started = performance.now();
  assert.deepEqual(pick("text", expr, ["a".repeat(200)]), []);
  assert.ok(performance.now() - started < 50, "글자 수에 비례");
  assert.deepEqual(pick("text", "a%b%c", ["xAyBzC", "cba", "abc"]), ["xAyBzC", "abc"], "순서대로");
  assert.deepEqual(pick("text", "%", ["무엇이든", "x"]), ["무엇이든", "x"]);
});

test("% 식은 %를 .*로 바꾼 정규식(i 플래그)과 매칭 결과가 같다: 그리스어 시그마, 독일어 ß, 터키어 İ, 줄바꿈", () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exprs = ["ΟΣ%", "ος%", "%Σ", "ß%", "ss%", "SS%", "İ%", "i%", "ı%", "a%b", "k%", "%"];
  const values = ["ΟΣΑ", "οσα", "ΑΟΣ", "aος", "ß", "SS", "ss", "İ", "i", "I", "ı", "a\nb", "ab", "K", "\u212a"];
  for (const expr of exprs) {
    const regex = new RegExp(expr.split("%").map(escape).join(".*"), "i");
    assert.deepEqual(
      pick("text", expr, values),
      values.filter((value) => regex.test(value)),
      expr,
    );
  }
});

// 글자별 케이스 폴딩(기준 구현): 대문자로 바꾸되 여러 글자가 되거나 비ASCII에서 ASCII로 바뀌면 그대로 둔다
const unitFold = (text: string) =>
  text
    .split("")
    .map((unit) => {
      const upper = unit.toUpperCase();
      return upper.length !== 1 || (unit.charCodeAt(0) >= 128 && upper.charCodeAt(0) < 128) ? unit : upper;
    })
    .join("");

test("케이스 폴딩: 구간을 통째로 대문자로 바꿔도 글자마다 변환한 것과 같다(BMP의 모든 코드 유닛, 이모지, ß, 결합 문자, 그리스 문자가 섞인 문자열)", () => {
  for (let code = 0; code < 0x10000; code++) {
    const unit = String.fromCharCode(code);
    assert.equal(foldCase(unit), unitFold(unit), code.toString(16));
  }
  const pieces = ["a", "Z", "ß", "ı", "ſ", "İ", "ŉ", "ǰ", "ΐ", "ﬀ", "Σ", "ς", "σ", "\u0345", "\u0301", "가", "ㄱ", "😀", "\uD83D", "\uDE00", " ", "\n", "Straße", "ΣΑΣ"];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < 20000; i++) {
    let text = "";
    for (let k = next() % 12; k > 0; k--) text += pieces[next() % pieces.length];
    assert.equal(foldCase(text), unitFold(text), JSON.stringify(text));
  }
});
