"use strict";

// src/configDataLoader.js — config/*.yaml을 읽는 단일 통로.
//
// 이 파일들은 주인이 둘이다: 손으로 고치는 운영자와, 대시보드(계획 5단계). 그래서
//  · 봇을 켜 둔 채 고쳐도 반영돼야 하고(mtime),
//  · 사람이 낸 문법 오류가 재생을 끊으면 안 되며(직전 값 유지),
//  · 설치가 어긋난 것은 조용히 넘어가면 안 된다(기동 거부).

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const loader = require("../src/configDataLoader");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-config-"));

const write = (name, text) => fs.writeFileSync(path.join(DIR, `${name}.yaml`), text);

before(() => loader._setConfigDir(DIR));
after(() => {
  loader._setConfigDir(path.join(__dirname, "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true });
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

test("없으면 기동을 멈추고 무엇을 할지 알린다", () => {
  loader._cache.clear();
  const err = thrown(() => loader.load("nothing"));
  assert.equal(err.code, "CONFIG_MISSING");
  assert.match(err.message, /example\.yaml/, "어디서 복사하면 되는지 알려준다");
});

test("주석이 있어도 읽고, 파일이 바뀌면 다시 읽는다", () => {
  write("sample", "# 주석\nvalue: 1\n");
  assert.equal(loader.load("sample").value, 1);

  // mtime이 같으면 다시 읽지 않는다 — 매 호출 디스크를 때리지 않게
  const first = loader.load("sample");
  assert.equal(loader.load("sample"), first, "같은 것을 돌려준다");

  write("sample", "# 주석\nvalue: 2\n");
  fs.utimesSync(path.join(DIR, "sample.yaml"), new Date(), new Date(Date.now() + 1000));
  assert.equal(loader.load("sample").value, 2, "봇을 켜 둔 채 고쳐도 반영된다");
});

// 사람이 고치는 파일이라 문법 오류가 난다. 저장하다 만 파일 한 번에 재생이 멈추면 안 된다.
test("돌던 중 문법이 깨지면 직전 값을 유지한다", () => {
  write("broken", "value: 1\n");
  assert.equal(loader.load("broken").value, 1);

  write("broken", "value: [\n  깨진\n"); // 닫히지 않은 배열
  fs.utimesSync(path.join(DIR, "broken.yaml"), new Date(), new Date(Date.now() + 1000));
  assert.equal(loader.load("broken").value, 1, "직전 값으로 계속 돈다");
});

test("처음부터 문법이 깨져 있으면 멈춘다 — 탭 안내까지", () => {
  loader._cache.delete("bad");
  write("bad", "value: [\n");
  const err = thrown(() => loader.load("bad"));
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /탭/, "YAML에서 가장 흔한 실수를 짚어준다");
});

// 실측(2026-09-16): 이 라이브러리는 YAML 1.2 core라 no·yes·on·off·y·n이 전부 문자열이다.
// 값으로 읽히는 것은 true/false/null뿐이고, null 키는 빈 문자열이 된다.
test("true·false·null 은 장르 id로 쓸 수 없다 — 따옴표를 써도 마찬가지", () => {
  for (const key of ["true", '"true"', "null"]) {
    write("genres", `defaults: {}\ngenres:\n  ${key}:\n    label: 값\n`);
    fs.utimesSync(path.join(DIR, "genres.yaml"), new Date(), new Date(Date.now() + 1000));
    const err = thrown(() => loader.genres());
    assert.equal(err.code, "CONFIG_INVALID", key);
    assert.match(err.message, /쓸 수 없는 이름/);
  }
});

test("no·on 같은 말은 그냥 장르 키가 된다 — 따옴표가 필요 없다", () => {
  write("genres", "defaults: {}\ngenres:\n  no:\n    label: 노\n  on:\n    label: 온\n");
  fs.utimesSync(path.join(DIR, "genres.yaml"), new Date(), new Date(Date.now() + 1000));
  assert.deepEqual(Object.keys(loader.genres().genres), ["no", "on"]);
});

test("defaults와 genres를 함께 돌려준다", () => {
  write("genres", "defaults:\n  prefetchCount: 2\ngenres:\n  pop:\n    label: 팝\n");
  fs.utimesSync(path.join(DIR, "genres.yaml"), new Date(), new Date(Date.now() + 1000));
  const cfg = loader.genres();
  assert.deepEqual(Object.keys(cfg.genres), ["pop"]);
  assert.equal(cfg.defaults.prefetchCount, 2);
});

// ── 쓰기 (대시보드) ───────────────────────────────────────────────────────

// 주석 보존은 YAML을 고른 이유 전체다. 통째로 다시 쓰면 사람이 적어 둔 메모가 날아가고,
// 그러면 "대시보드 없이도 손으로 고친다"는 전제가 무너진다.
test("저장해도 사람이 적은 주석이 남는다 — 값이 바뀐 자리의 주석까지", () => {
  write("genres", ["# 파일 머리", "", "defaults:", "  # 곡 수 메모", "  prefetchCount: 1", "genres:", "  pop:", "    # 손으로 적은 메모", "    label: 팝", "    keywords:", "      - pop music", ""].join("\n"));

  const data = loader.load("genres");
  data.genres.pop.label = "팝송";
  data.genres.rock = { label: "록", keywords: ["rock music"] };
  loader.save("genres", data);

  const text = fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8");
  assert.match(text, /# 파일 머리/);
  assert.match(text, /# 곡 수 메모/);
  assert.match(text, /# 손으로 적은 메모/, "값이 바뀐 자리의 주석도 남아야 한다");
  assert.match(text, /label: 팝송/);
  assert.match(text, /rock:/);
});

test("사라진 키는 지워진다", () => {
  write("genres", "defaults: {}\ngenres:\n  pop:\n    label: 팝\n  rock:\n    label: 록\n");
  const data = loader.load("genres");
  delete data.genres.rock;
  loader.save("genres", data);

  assert.doesNotMatch(fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8"), /rock:/);
});

test("저장하면 다음 읽기가 새 값을 가져온다", () => {
  write("genres", "defaults:\n  prefetchCount: 1\ngenres:\n  pop:\n    label: 팝\n");
  assert.equal(loader.load("genres").defaults.prefetchCount, 1);

  const data = loader.load("genres");
  data.defaults.prefetchCount = 3;
  loader.save("genres", data);

  assert.equal(loader.load("genres").defaults.prefetchCount, 3, "읽어 둔 것을 그대로 돌려주면 안 된다");
});

// ── 저장 전 검사 ──────────────────────────────────────────────────────────

test("검사: 쓸 만하면 아무 말이 없다", () => {
  assert.deepEqual(loader.validateGenres({ defaults: { prefetchCount: 1 }, genres: { pop: { label: "팝", keywords: ["a"] } } }), []);
});

test("검사: 장르가 없거나 25개를 넘으면 걸린다", () => {
  assert.match(loader.validateGenres({ genres: {} }).join(" "), /하나도 없습니다/);

  const many = {};
  for (let i = 0; i < 26; i++) many["g" + i] = { label: "ㄱ", keywords: ["a"] };
  assert.match(loader.validateGenres({ genres: many }).join(" "), /25개까지/);
});

test("검사: 이름·검색어가 비면 걸린다", () => {
  const problems = loader.validateGenres({ genres: { pop: { label: "", keywords: [] }, rock: { label: "록", keywords: ["  "] } } });
  assert.match(problems.join(" "), /표시 이름/);
  assert.match(problems.join(" "), /검색어/);
  assert.match(problems.join(" "), /빈 검색어/);
});

test("검사: 길이 범위가 뒤집혀 있으면 걸린다", () => {
  const problems = loader.validateGenres({ defaults: { minDurationSec: 600, maxDurationSec: 60 }, genres: { pop: { label: "팝", keywords: ["a"] } } });
  assert.match(problems.join(" "), /minDurationSec이 maxDurationSec보다/);
});
