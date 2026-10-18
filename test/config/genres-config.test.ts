// src/config/genres.ts — 장르 설정을 읽을 때 필터링하는 이름 · 이모지와 저장 전 검사.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import * as genreConfig from "../../src/config/genres.ts";
import * as documents from "../../src/config/documents.ts";
import { GENRE_DEFAULTS } from "../../src/config/schema/genres.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import sink from "../../src/infra/log/sink.ts";
import YAML from "yaml";

// 장르 문서를 바꾼다(옛 설정 파일 형식의 YAML 글로 적는다). 읽어 둔 직전 설정은 그대로 둔다(돌던 중에 바뀐 것처럼)
const write = (name: "genres", text: string) => documents._use(name, YAML.parse(text));

// 테스트마다 기동한 것처럼 본다. 직전에 맞던 설정이 남아 있으면 틀린 문서에도 그것으로 돈다
beforeEach(() => genreConfig._reset());
after(() => useDefaultDocuments());

/**
 * 기동 때처럼 읽어 알린 문제. 틀린 문서는 던지지 않고(기동을 멈추지 않는다) 알린 뒤 빈 설정으로 돈다.
 * fn 을 주면 그것으로 읽는다
 */
function complaint(fn: () => unknown = () => genreConfig.genres()) {
  genreConfig._reset();
  const from = sink.buffer.length;
  const got = fn();
  const line = sink.buffer.slice(from).find((e) => e.level === "error");
  if (!line) throw new Error("알리지 않았습니다");
  return { code: "CONFIG_INVALID", message: line.text, got };
}

// 실측(2026-09-16): 이 라이브러리는 YAML 1.2 core라 no·yes·on·off·y·n이 전부 문자열이다.
// 값으로 읽히는 것은 true/false/null뿐이고, null 키는 빈 문자열이 된다.
test("true·false·null 은 장르 id로 쓸 수 없다 — 따옴표를 써도 마찬가지", () => {
  for (const key of ["true", '"true"', "null"]) {
    write("genres", `defaults: {}\ngenres:\n  ${key}:\n    label: 값\n`);
    const err = complaint();
    assert.equal(err.code, "CONFIG_INVALID", key);
    assert.match(err.message, /쓸 수 없습니다/);
  }
});

test("숫자만으로 된 장르 이름은 쓸 수 없다", () => {
  // JavaScript 객체가 정수처럼 생긴 키를 앞으로 당겨서, 드래그해서 옮긴 순서가 조용히 어긋난다.
  write("genres", ["defaults: {}", "genres:", "  80:", "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));

  const err = complaint();
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /순서가 어긋납니다/);

  assert.match(genreConfig.validateGenres({ genres: { 80: { sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" "), /순서가 어긋납니다/);
  assert.deepEqual(genreConfig.validateGenres({ genres: { "80년대": { sources: [{ type: "keyword", keywords: ["a"] }] } } }), [], "글자가 붙으면 괜찮다");
});

test("emoji 필드에 이모지가 아닌 값이 있으면 읽을 때 걸린다", () => {
  // 대시보드는 선택기로만 입력하지만 DB 는 바깥에서도 고칠 수 있다. 읽을 때 잡지 않으면
  // 디스코드가 선택 메뉴 전체를 거부해 /autoplay가 원인에서 한참 떨어진 위치에서 죽는다.
  const load = (emoji: string) => {
    write("genres", ["defaults: {}", "genres:", "  팝:", `    emoji: ${emoji}`, "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));
    return genreConfig.genres();
  };

  assert.equal(load("🇰🇷").genres.팝.emoji, "🇰🇷", "국기처럼 코드포인트가 여럿인 것도 한 글자다");
  assert.equal(load('""').genres.팝.emoji, "", "비워 두는 것은 괜찮다");

  const err = complaint(() => load("abc"));
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /이모지/);
});

test("no·on 같은 말은 그냥 장르 키가 된다 — 따옴표가 필요 없다", () => {
  const src = "    sources: [{ type: keyword, keywords: [a] }]";
  write("genres", ["defaults: {}", "genres:", "  no:", "    label: 노", src, "  on:", "    label: 온", src, ""].join("\n"));
  assert.deepEqual(Object.keys(genreConfig.genres().genres), ["no", "on"]);
});

test("defaults와 genres를 함께 돌려준다", () => {
  write("genres", ["defaults:", "  prefetchCount: 2", "genres:", "  pop:", "    label: 팝", "    sources: [{ type: keyword, keywords: [a] }]", ""].join("\n"));
  const cfg = genreConfig.genres();
  assert.deepEqual(Object.keys(cfg.genres), ["pop"]);
  assert.equal(cfg.defaults.prefetchCount, 2);
});

// ── 저장 전 검사 ──────────────────────────────────────────────────────────

test("검사: 쓸 만하면 아무 말이 없다", () => {
  assert.deepEqual(genreConfig.validateGenres({ defaults: { prefetchCount: 1 }, genres: { 팝: { sources: [{ type: "keyword", keywords: ["a"] }] } } }), []);
});

test("검사: 장르가 없거나 25개를 넘으면 걸린다", () => {
  assert.match(genreConfig.validateGenres({ genres: {} }).join(" "), /하나도 없습니다/);

  const many: Record<string, unknown> = {};
  for (let i = 0; i < 26; i++) many["장르" + i] = { sources: [{ type: "keyword", keywords: ["a"] }] };
  assert.match(genreConfig.validateGenres({ genres: many }).join(" "), /25개까지/);
});

test("검사: 소스에 필요한 값이 비면 걸린다", () => {
  // keyword는 검색어가, lastfm은 태그가, 유튜브 재생목록은 주소가 있어야 한다
  const of = (genre: unknown) => genreConfig.validateGenres({ genres: { 팝: genre } }).join(" ");
  assert.match(of({ sources: [{ type: "keyword", keywords: [] }] }), /keywords/);
  assert.match(of({ sources: [{ type: "keyword", keywords: ["  "] }] }), /keywords/, "공백뿐인 것도 빈 것이다");
  assert.match(of({ sources: [{ type: "lastfm" }] }), /tags/);
  assert.match(of({ sources: [{ type: "youtube" }] }), /url/);
  assert.equal(of({ sources: [{ type: "lbradio", prompt: "tag:(pop)" }] }), "", "tags 대신 prompt만 있어도 된다");
});

test("검사: 모르는 소스 종류는 걸린다", () => {
  assert.match(genreConfig.validateGenres({ genres: { 팝: { sources: [{ type: "없는것", keywords: ["a"] }] } } }).join(" "), /모르는 종류/);
});

// 맨 위 keywords:는 옛 모양이다. 조용히 읽어 주면 두 모양을 영원히 들고 가게 된다.
test("검사: 맨 위 keywords: 는 옮기라고 알려 준다", () => {
  const problems = genreConfig.validateGenres({ genres: { 팝: { keywords: ["a"], sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" ");
  assert.match(problems, /sources: 로 옮겨/);
});

// 값이 정해져 있는 필드는 오타를 여기서 잡는다. 안 잡으면 저쪽이 422를 주고 그 소스가 조용히
// 빈손이 되어, 설정은 멀쩡해 보이는데 그 소스만 안 쓰이는 상황이 된다.
test("검사: 정해진 값이 아닌 것은 무엇을 쓸 수 있는지 알려 준다", () => {
  const of = (source: unknown) => genreConfig.validateGenres({ genres: { 팝: { sources: [source] } } }).join(" ");

  assert.match(of({ type: "animethemes", mediaFormat: ["TVShort"] }), /TV Short/, "띄어쓰기를 빠뜨린 것을 잡아야 한다");
  assert.match(of({ type: "animethemes", themeType: "OP1" }), /themeType/);
  assert.match(of({ type: "animethemes", seasonFrom: "가을" }), /Winter, Spring, Summer, Fall/);
  assert.match(of({ type: "lbradio", tags: ["pop"], mode: "normal" }), /easy, medium, hard/);
  assert.match(of({ type: "touhoudb", songTypes: ["編曲"] }), /Arrangement/, "일본어 표기는 못 쓴다");
  assert.match(of({ type: "vocadb", sort: "Popularity" }), /RatingScore/);

  assert.equal(of({ type: "animethemes", mediaFormat: ["TV", "TV Short"], themeType: "OP", seasonFrom: "Fall" }), "");
  assert.equal(of({ type: "touhoudb", songTypes: ["Arrangement", "Rearrangement"] }), "");
});

test("검사: weight와 연도 범위도 본다", () => {
  const of = (source: unknown) => genreConfig.validateGenres({ genres: { 팝: { sources: [source] } } }).join(" ");
  assert.match(of({ type: "animethemes", weight: 0 }), /weight/);
  assert.match(of({ type: "animethemes", yearFrom: 2020, yearTo: 2010 }), /yearFrom/);
  assert.match(of({ type: "vocadb", minScore: -1 }), /minScore/);
});

test("검사: 이모지 필드에 이모지가 아닌 값이 있으면 걸린다", () => {
  // 대시보드는 선택기로만 입력하지만 DB 는 바깥에서도 고칠 수 있다. 여기서 막지 않으면
  // 디스코드 선택 메뉴가 원인에서 한참 떨어진 위치에서 거부한다.
  const of = (emoji: string | undefined) => genreConfig.validateGenres({ genres: { 팝: { emoji, sources: [{ type: "keyword", keywords: ["a"] }] } } });

  assert.deepEqual(of("🇰🇷"), [], "국기처럼 코드포인트가 여럿인 것도 한 글자다");
  assert.deepEqual(of("1️⃣"), [], "키캡도 한 글자다");
  assert.deepEqual(of(""), [], "비워 두는 것은 괜찮다");
  assert.deepEqual(of(undefined), [], "없는 것도 괜찮다");
  assert.match(of("abc").join(" "), /이모지 한 글자/);
  assert.match(of("🎤🎸").join(" "), /이모지 한 글자/, "두 개는 안 된다");
});

test("검사: 길이 범위가 뒤집혀 있으면 걸린다", () => {
  const problems = genreConfig.validateGenres({ defaults: { minDurationSec: 600, maxDurationSec: 60 }, genres: { 팝: { sources: [{ type: "keyword", keywords: ["a"] }] } } });
  assert.match(problems.join(" "), /minDurationSec이 maxDurationSec보다/);
});

// 장르마다 기본값의 길이를 덮어쓸 수 있다(기본 문서 · 재생이 쓴다). 틀린 값이 조용히 지나가지 않게 본다. 차단어는 전역과 키워드 출처 필드에만
test("검사: 장르별 덮어쓰기(길이)도 본다", () => {
  const of = (extra: object) => genreConfig.validateGenres({ genres: { 팝: { ...extra, sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" ");
  assert.equal(of({ minDurationSec: 30, maxDurationSec: 1800 }), "");
  assert.match(of({ minDurationSec: -1 }), /팝: minDurationSec/);
  assert.match(of({ maxDurationSec: 0 }), /팝: maxDurationSec/);
  assert.match(genreConfig.validateGenres({ defaults: { blockedKeywords: "live" }, genres: { 팝: { sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" "), /blockedKeywords/);
});

test("검사: 장르의 실제 길이 범위(기본값 위에 얹은 것)가 뒤집혀 있으면 걸린다", () => {
  const of = (genre: object) => genreConfig.validateGenres({ defaults: { minDurationSec: 60, maxDurationSec: 600 }, genres: { 팝: { ...genre, sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" ");
  assert.match(of({ minDurationSec: 900 }), /팝: .*minDurationSec.*900.*maxDurationSec.*600/);
  assert.match(of({ maxDurationSec: 30 }), /팝: .*minDurationSec.*60.*maxDurationSec.*30/);
  assert.equal(of({ minDurationSec: 300 }), "");
});

// 비운 최소 길이는 기본값(GENRE_DEFAULTS)으로 돈다. 그 값보다 짧은 상한이면 아무 곡도 지나가지 못한다
test("검사: 최소 길이를 비우면 기본값과 상한을 견준다", () => {
  const of = (defaults: object, genre: object = {}) => genreConfig.validateGenres({ defaults, genres: { 팝: { ...genre, sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" ");
  const min = GENRE_DEFAULTS.minDurationSec;
  assert.ok(of({ maxDurationSec: 30 }).includes(`maxDurationSec(30)이 비운 minDurationSec의 기본값(${min})보다 작습니다.`));
  assert.ok(of({}, { maxDurationSec: 30 }).includes(`팝: 이 장르의 minDurationSec(${min})이 maxDurationSec(30)보다 큽니다.`));
  assert.equal(of({ maxDurationSec: 600 }), "");
});

// 비운 필드는 손대지 않은 기본 문서와 같게 돈다
test("기본값은 기본 문서의 defaults 와 같다(상한은 비우면 없다)", () => {
  const example = documents.defaultOf("genres") as { defaults: Record<string, unknown> };
  assert.deepEqual([example.defaults.prefetchCount, example.defaults.minDurationSec], [GENRE_DEFAULTS.prefetchCount, GENRE_DEFAULTS.minDurationSec]);
});

test("검사: 미리 선택해 둘 곡 수는 장르마다 둘 수 없다(기본값에만)", () => {
  const problems = genreConfig.validateGenres({ genres: { 팝: { prefetchCount: 2, sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" ");
  assert.match(problems, /팝: prefetchCount.*defaults/);
});

// 이름 · 이모지 · 소스 문제를 한 번에 다 알린다. 하나 고치고 다시 시작해야 다음 문제가 보이던 것을 없앴다
test("틀린 문서는 문제를 한 번에 모두 알린다(대시보드 저장 전 검사와 같은 문구)", () => {
  write("genres", ["defaults: {}", "genres:", "  80:", "    sources: [{ type: keyword, keywords: [pop] }]", "  팝:", "    emoji: abc", "    sources: []", ""].join("\n"));
  const err = complaint();
  assert.equal(err.code, "CONFIG_INVALID");
  const lines = err.message.split("\n");
  assert.equal(lines[0], "자동재생 장르 설정을 읽을 수 없습니다:");
  assert.match(err.message, /"80": 숫자만으로 된 식별자는/);
  assert.match(err.message, /팝: emoji는 이모지 한 글자여야/);
  assert.match(err.message, /팝: 소스\(sources\)가 하나는 있어야/);
});

test("돌던 중 문서가 틀리면 직전에 맞던 설정으로 돈다(던지지 않는다)", () => {
  write("genres", ["defaults: {}", "genres:", "  팝:", "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));
  assert.deepEqual(Object.keys(genreConfig.genres().genres), ["팝"]);

  write("genres", ["defaults: {}", "genres:", "  팝:", "    sources: []", ""].join("\n"));
  assert.deepEqual(Object.keys(genreConfig.genres().genres), ["팝"], "틀린 문서 대신 직전 값");
});

// 키는 대시보드에서 입력하므로 키가 없다고 기동을 멈추면 입력할 곳도 안 뜬다(2차 16단계 "정한 것" 6)
test("쓸 소스가 하나도 없는 장르: 기동은 멈추지 않고 그 장르만 못 쓴다. 키를 입력하면 바로 쓴다", async () => {
  const config = (await import("../../src/config/index.ts")).default;
  const saved = config.sources.lastfmKey;
  write("genres", ["defaults: {}", "genres:", "  재즈:", "    sources: [{ type: lastfm, tags: [jazz] }]", "  팝:", "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));
  try {
    config.sources.lastfmKey = null;
    assert.deepEqual(Object.keys(genreConfig.genres().genres), ["재즈", "팝"]);
    assert.deepEqual(genreConfig.unusableGenre("재즈"), ["Last.fm"]);
    assert.equal(genreConfig.unusableGenre("팝"), null);
    assert.equal(genreConfig.unusableGenre("없는장르"), null, "모르는 장르는 unknown-genre 쪽이 본다");

    config.sources.lastfmKey = "key";
    assert.equal(genreConfig.unusableGenre("재즈"), null);
  } finally {
    config.sources.lastfmKey = saved;
  }
});
