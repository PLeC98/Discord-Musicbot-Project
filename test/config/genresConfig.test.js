"use strict";

// src/config/genres.js — 장르 설정을 읽을 때 거르는 이름 · 이모지와 저장 전 검사.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const yamlStore = require("../../src/config/yamlStore");
const genreConfig = require("../../src/config/genres");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-config-"));

const write = (name, text) => fs.writeFileSync(path.join(DIR, `${name}.yaml`), text);

// 로더는 mtimeMs가 정확히 같으면 캐시를 재사용한다. 테스트가 `Date.now()`로 찍으면 앞 테스트와
// 같은 밀리초에 들어갈 수 있고, 그러면 새로 쓴 파일 대신 앞 테스트의 결과가 나온다.
// 부를 때마다 반드시 커지는 값을 쓴다.
let stamp = Date.now();
const touch = (name) => {
  stamp += 1000;
  fs.utimesSync(path.join(DIR, `${name}.yaml`), new Date(stamp), new Date(stamp));
};

before(() => yamlStore._setConfigDir(DIR));
after(() => {
  yamlStore._setConfigDir(path.join(__dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

// assert.throws는 오류를 돌려주지 않는다 — 검증기로 받는다.
const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("던지지 않았습니다");
};

// 실측(2026-09-16): 이 라이브러리는 YAML 1.2 core라 no·yes·on·off·y·n이 전부 문자열이다.
// 값으로 읽히는 것은 true/false/null뿐이고, null 키는 빈 문자열이 된다.
test("true·false·null 은 장르 id로 쓸 수 없다 — 따옴표를 써도 마찬가지", () => {
  for (const key of ["true", '"true"', "null"]) {
    write("genres", `defaults: {}\ngenres:\n  ${key}:\n    label: 값\n`);
    touch("genres");
    const err = thrown(() => genreConfig.genres());
    assert.equal(err.code, "CONFIG_INVALID", key);
    assert.match(err.message, /쓸 수 없습니다/);
  }
});

test("숫자만으로 된 장르 이름은 쓸 수 없다", () => {
  // JavaScript 객체가 정수처럼 생긴 키를 앞으로 당겨서, 끌어 옮긴 차례가 조용히 어긋난다.
  write("genres", ["defaults: {}", "genres:", "  80:", "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));
  touch("genres");

  const err = thrown(() => genreConfig.genres());
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /차례가 어긋납니다/);

  assert.match(genreConfig.validateGenres({ genres: { 80: { sources: [{ type: "keyword", keywords: ["a"] }] } } }).join(" "), /차례가 어긋납니다/);
  assert.deepEqual(genreConfig.validateGenres({ genres: { "80년대": { sources: [{ type: "keyword", keywords: ["a"] }] } } }), [], "글자가 붙으면 괜찮다");
});

test("emoji 자리에 이모지가 아닌 값이 있으면 읽을 때 걸린다", () => {
  // 대시보드는 선택기로만 넣지만 파일은 손으로도 고칠 수 있다. 읽을 때 잡지 않으면
  // 디스코드가 선택 메뉴 전체를 거부해 /autoplay가 원인에서 한참 떨어진 자리에서 죽는다.
  const load = (emoji) => {
    write("genres", ["defaults: {}", "genres:", "  팝:", `    emoji: ${emoji}`, "    sources: [{ type: keyword, keywords: [pop] }]", ""].join("\n"));
    touch("genres");
    return genreConfig.genres();
  };

  assert.equal(load("🇰🇷").genres.팝.emoji, "🇰🇷", "국기처럼 코드포인트가 여럿인 것도 한 글자다");
  assert.equal(load('""').genres.팝.emoji, "", "비워 두는 것은 괜찮다");

  const err = thrown(() => load("abc"));
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /이모지/);
});

test("no·on 같은 말은 그냥 장르 키가 된다 — 따옴표가 필요 없다", () => {
  const src = "    sources: [{ type: keyword, keywords: [a] }]";
  write("genres", ["defaults: {}", "genres:", "  no:", "    label: 노", src, "  on:", "    label: 온", src, ""].join("\n"));
  touch("genres");
  assert.deepEqual(Object.keys(genreConfig.genres().genres), ["no", "on"]);
});

test("defaults와 genres를 함께 돌려준다", () => {
  write("genres", ["defaults:", "  prefetchCount: 2", "genres:", "  pop:", "    label: 팝", "    sources: [{ type: keyword, keywords: [a] }]", ""].join("\n"));
  touch("genres");
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

  const many = {};
  for (let i = 0; i < 26; i++) many["장르" + i] = { sources: [{ type: "keyword", keywords: ["a"] }] };
  assert.match(genreConfig.validateGenres({ genres: many }).join(" "), /25개까지/);
});

test("검사: 소스에 필요한 값이 비면 걸린다", () => {
  // keyword는 검색어가, lastfm은 태그가, 유튜브 재생목록은 주소가 있어야 한다
  const of = (genre) => genreConfig.validateGenres({ genres: { 팝: genre } }).join(" ");
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

// 값이 정해져 있는 칸은 오타를 여기서 잡는다. 안 잡으면 저쪽이 422를 주고 그 소스가 조용히
// 빈손이 되어, 설정은 멀쩡해 보이는데 그 소스만 안 쓰이는 꼴이 된다.
test("검사: 정해진 값이 아닌 것은 무엇을 쓸 수 있는지 알려 준다", () => {
  const of = (source) => genreConfig.validateGenres({ genres: { 팝: { sources: [source] } } }).join(" ");

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
  const of = (source) => genreConfig.validateGenres({ genres: { 팝: { sources: [source] } } }).join(" ");
  assert.match(of({ type: "animethemes", weight: 0 }), /weight/);
  assert.match(of({ type: "animethemes", yearFrom: 2020, yearTo: 2010 }), /yearFrom/);
  assert.match(of({ type: "vocadb", minScore: -1 }), /minScore/);
});

test("검사: 이모지 자리에 이모지가 아닌 값이 있으면 걸린다", () => {
  // 대시보드는 선택기로만 넣지만 파일은 손으로도 고칠 수 있다. 여기서 막지 않으면
  // 디스코드 선택 메뉴가 원인에서 한참 떨어진 자리에서 거부한다.
  const of = (emoji) => genreConfig.validateGenres({ genres: { 팝: { emoji, sources: [{ type: "keyword", keywords: ["a"] }] } } });

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

// 이름 · 이모지 · 소스 문제를 한 번에 다 알린다. 하나 고치고 다시 켜야 다음 문제가 보이던 것을 없앴다
test("기동 오류는 문제를 한 번에 모두 나열한다(대시보드 저장 전 검사와 같은 문구)", () => {
  write("genres", ["defaults: {}", "genres:", "  80:", "    sources: [{ type: keyword, keywords: [pop] }]", "  팝:", "    emoji: abc", "    sources: []", ""].join("\n"));
  touch("genres");
  const err = thrown(() => genreConfig.genres());
  assert.equal(err.code, "CONFIG_INVALID");
  const lines = err.message.split("\n");
  assert.equal(lines[0], "config/genres.yaml 을 읽을 수 없습니다:");
  assert.match(err.message, /"80": 숫자만으로 된 이름은/);
  assert.match(err.message, /팝: emoji는 이모지 한 글자여야/);
  assert.match(err.message, /팝: 소스\(sources\)가 하나는 있어야/);
});
