// src/config/yaml-store.ts — config/*.yaml을 읽고 주석을 남긴 채 고쳐 쓰는 통로.
//
// 이 파일들은 주인이 둘이다: 손으로 고치는 운영자와, 대시보드(계획 5단계). 그래서
//  · 봇을 켜 둔 채 고쳐도 반영돼야 하고(mtime),
//  · 사람이 낸 문법 오류가 재생을 끊으면 안 되며(직전 값 유지),
//  · 설치가 어긋난 것은 조용히 넘어가면 안 된다(기동 거부).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as yamlStore from "../../src/config/yaml-store.ts";
import { toRows, toMap } from "../../dashboard/src/utils/genre-rows.ts";
import sink from "../../src/infra/log/sink.ts";
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-config-"));

// 테스트가 적어 둔 파일의 모양
type GenresFile = { defaults: Record<string, unknown>; genres: Record<string, Record<string, unknown>> };
type SampleFile = { value?: number; messages: string[] };
const loadGenres = () => yamlStore.load("genres") as GenresFile;
const loadSample = () => yamlStore.load("sample") as SampleFile;

const write = (name: string, text: string) => fs.writeFileSync(path.join(DIR, `${name}.yaml`), text);

// 로더는 mtimeMs가 정확히 같으면 캐시를 재사용한다. 테스트가 `Date.now()`로 찍으면 앞 테스트와
// 같은 밀리초에 들어갈 수 있고, 그러면 새로 쓴 파일 대신 앞 테스트의 결과가 나온다.
// 부를 때마다 반드시 커지는 값을 쓴다.
let stamp = Date.now();
const touch = (name: string) => {
  stamp += 1000;
  fs.utimesSync(path.join(DIR, `${name}.yaml`), new Date(stamp), new Date(stamp));
};

before(() => yamlStore._setConfigDir(DIR));
after(() => {
  yamlStore._setConfigDir(path.join(import.meta.dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

// assert.throws는 오류를 돌려주지 않는다 — 검증기로 받는다.
const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("던지지 않았습니다");
};

test("없으면 기동을 멈추고 무엇을 할지 알린다", () => {
  yamlStore._cache.clear();
  const err = thrown(() => yamlStore.load("nothing"));
  assert.equal(err.code, "CONFIG_MISSING");
  assert.match(err.message, /example\.yaml/, "어디서 복사하면 되는지 알려준다");
});

test("주석이 있어도 읽고, 파일이 바뀌면 다시 읽는다", () => {
  write("sample", "# 주석\nvalue: 1\n");
  assert.equal(loadSample().value, 1);

  // mtime이 같으면 다시 읽지 않는다 — 매 호출 디스크를 때리지 않게
  const first = loadSample();
  assert.equal(loadSample(), first, "같은 것을 돌려준다");

  write("sample", "# 주석\nvalue: 2\n");
  touch("sample");
  assert.equal(loadSample().value, 2, "봇을 켜 둔 채 고쳐도 반영된다");
});

// 사람이 고치는 파일이라 문법 오류가 난다. 저장하다 만 파일 한 번에 재생이 멈추면 안 된다.
test("돌던 중 문법이 깨지면 직전 값을 유지한다", () => {
  write("broken", "value: 1\n");
  assert.equal(yamlStore.load("broken").value, 1);

  write("broken", "value: [\n  깨진\n"); // 닫히지 않은 배열
  touch("broken");
  assert.equal(yamlStore.load("broken").value, 1, "직전 값으로 계속 돈다");
});

// 설정은 요청마다 읽는다. 깨진 채로 두면 읽을 때마다 같은 경고가 쌓였다
test("직전 값으로 버티는 동안 같은 상태는 한 번만 알리고, 풀리면 한 줄", () => {
  const seen: string[] = [];
  let watching = true;
  sink.addDestination((rec) => watching && seen.push(JSON.stringify(rec)));
  // 로그는 늦게 닿는다. 앞 시험의 줄이 섞이지 않게 이 파일 것만 센다
  const count = (what: string) => seen.filter((one) => one.includes(what) && one.includes("holding.yaml")).length;
  try {
    write("holding", "value: 1\n");
    touch("holding");
    yamlStore.load("holding");

    write("holding", "value: [\n");
    touch("holding");
    for (let i = 0; i < 3; i++) assert.equal(yamlStore.load("holding").value, 1);
    assert.equal(count("읽지 못했습니다"), 1, "깨진 동안 한 번");

    fs.rmSync(path.join(DIR, "holding.yaml"));
    for (let i = 0; i < 3; i++) yamlStore.load("holding");
    assert.equal(count("찾지 못했습니다"), 1, "없는 동안 한 번");

    write("holding", "value: 2\n");
    touch("holding");
    assert.equal(yamlStore.load("holding").value, 2);
    assert.equal(count("다시 읽었습니다"), 1);

    write("holding", "value: [\n");
    touch("holding");
    yamlStore.load("holding");
    assert.equal(count("읽지 못했습니다"), 2, "다시 깨지면 새로 알린다");
  } finally {
    watching = false;
  }
});

test("처음부터 문법이 깨져 있으면 멈춘다 — 탭 안내까지", () => {
  yamlStore._cache.delete("bad");
  write("bad", "value: [\n");
  const err = thrown(() => yamlStore.load("bad"));
  assert.equal(err.code, "CONFIG_INVALID");
  assert.match(err.message, /탭/, "YAML에서 가장 흔한 실수를 짚어준다");
});

// YAML 문법 오류는 잘못된 줄을 인용한다. 키 파일이면 그 줄이 곧 키다
test("키 파일의 문법 오류는 줄 번호만 알리고 줄을 인용하지 않는다", () => {
  const KEY = "sk-yamlstore-do-not-log";
  const seen: string[] = [];
  let watching = true;
  sink.addDestination((rec) => watching && seen.push(JSON.stringify(rec)));
  try {
    yamlStore._cache.delete("ai-keys");
    write("ai-keys", `openai: ${KEY}\n  broken: [\n`);
    const err = thrown(() => yamlStore.load("ai-keys"));
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /line 1, column/, "어디가 틀렸는지는 알린다");
    assert.ok(!err.message.includes(KEY), err.message);

    // 돌던 중 깨지면 경고 한 줄로 알린다. 거기에도 없다
    write("ai-keys", `openai: ${KEY}\n`);
    touch("ai-keys");
    yamlStore.load("ai-keys");
    write("ai-keys", `openai: ${KEY}\nopenai: again\n`);
    touch("ai-keys");
    yamlStore.load("ai-keys");
    assert.ok(
      seen.some((one) => one.includes("ai-keys")),
      "경고는 남는다",
    );
    assert.ok(!seen.some((one) => one.includes(KEY)), "로그에 키가 없다");

    // 깨진 파일에 저장하려 하면 거절한다. 그 까닭(대시보드로 간다)에도 없다
    const refused = thrown(() => yamlStore.save("ai-keys", { openai: "new" }, { secret: true }));
    assert.match(refused.message, /저장할 수 없습니다/);
    assert.ok(!refused.message.includes(KEY), refused.message);
  } finally {
    watching = false;
  }
});

// ── 쓰기 (대시보드) ───────────────────────────────────────────────────────

// 주석 보존은 YAML을 고른 이유 전체다. 통째로 다시 쓰면 사람이 적어 둔 메모가 날아가고,
// 그러면 "대시보드 없이도 손으로 고친다"는 전제가 무너진다.
test("저장해도 사람이 적은 주석이 남는다 — 값이 바뀐 자리의 주석까지", () => {
  write("genres", ["# 파일 머리", "", "defaults:", "  # 곡 수 메모", "  prefetchCount: 1", "genres:", "  pop:", "    # 손으로 적은 메모", "    label: 팝", "    sources: [{ type: keyword, keywords: [pop music] }]", ""].join("\n"));

  const data = loadGenres();
  data.genres.pop.label = "팝송";
  data.genres.rock = { label: "록", sources: [{ type: "keyword", keywords: ["rock music"] }] };
  yamlStore.save("genres", data);

  const text = fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8");
  assert.match(text, /# 파일 머리/);
  assert.match(text, /# 곡 수 메모/);
  assert.match(text, /# 손으로 적은 메모/, "값이 바뀐 자리의 주석도 남아야 한다");
  assert.match(text, /label: 팝송/);
  assert.match(text, /rock:/);
});

// 대시보드 장르 화면에는 장르별 길이 · 차단할 말 칸이 없다. 행이 그것을 들고 있다가 돌려보내야 저장이 지우지 않는다
test("대시보드 장르 화면의 행을 거쳐 저장해도 장르별 덮어쓰기와 그 주석이 남는다", () => {
  write("genres", ["defaults:", "  minDurationSec: 60", "genres:", "  팝:", "    emoji: 🎤", "    # 팝만 짧은 곡도", "    minDurationSec: 30", "    blockedKeywords:", "      - live", "    sources:", "      - type: keyword", "        keywords:", "          - pop", ""].join("\n"));
  const data = loadGenres();
  const rows = toRows(data.genres);
  rows[0].emoji = "🎸";
  yamlStore.save("genres", { defaults: data.defaults, genres: toMap(rows) });

  const text = fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8");
  assert.match(text, /# 팝만 짧은 곡도\n {4}minDurationSec: 30/);
  assert.match(text, /blockedKeywords:\n {6}- live/);
  assert.match(text, /emoji: 🎸/);
  assert.deepEqual(Object.keys(loadGenres().genres.팝), ["emoji", "minDurationSec", "blockedKeywords", "sources"], "칸의 차례도 그대로");
});

test("장르 화면의 덮어쓰기 칸: 고치면 제자리에서, 비우면 빼고(전역 값), 새로 적으면 끝에", () => {
  write("genres", ["defaults:", "  minDurationSec: 60", "genres:", "  팝:", "    emoji: 🎤", "    minDurationSec: 30", "    blockedKeywords:", "      - Live", "    sources:", "      - type: keyword", "        keywords:", "          - pop", "  록:", "    sources:", "      - type: keyword", "        keywords:", "          - rock", ""].join("\n"));
  const rows = toRows(loadGenres().genres);
  assert.deepEqual([rows[0].minDurationSec, rows[0].maxDurationSec, rows[0].blockedKeywords], [30, null, ["live"]], "차단할 말은 소문자로(제목을 낮춰 견준다)");
  assert.deepEqual([rows[1].minDurationSec, rows[1].blockedKeywords], [null, []]);

  rows[0].minDurationSec = 45;
  rows[0].blockedKeywords = [];
  rows[1].maxDurationSec = 600;
  yamlStore.save("genres", { defaults: loadGenres().defaults, genres: toMap(rows) });

  const saved = loadGenres().genres;
  assert.deepEqual(Object.keys(saved.팝), ["emoji", "minDurationSec", "sources"], "비운 차단할 말은 빠지고 나머지는 제자리");
  assert.equal(saved.팝.minDurationSec, 45);
  assert.deepEqual(Object.keys(saved.록), ["sources", "maxDurationSec"], "새로 적은 칸은 끝에");
  assert.equal(saved.록.maxDurationSec, 600);
});

// 회귀 대상: 값은 그대로 두고 차례만 바꾸면 고칠 것이 없다고 보고 아무것도 쓰지 않았다.
// 대시보드는 저장이 됐다고 여기고 파일을 다시 읽어, 바꾼 차례가 도로 돌아갔다.
test("차례만 바꿔도 저장된다 — 주석은 쌍을 따라간다", () => {
  write("genres", ["defaults: {}", "genres:", "  팝:", "    sources: [{ type: keyword, keywords: [pop] }]", "  # 록 메모", "  록:", "    sources: [{ type: keyword, keywords: [rock] }]", "  재즈:", "    sources: [{ type: keyword, keywords: [jazz] }]", ""].join("\n"));

  const data = loadGenres();
  // 재즈를 맨 앞으로 — 값은 하나도 건드리지 않는다
  data.genres = { 재즈: data.genres.재즈, 팝: data.genres.팝, 록: data.genres.록 };
  yamlStore.save("genres", data);

  assert.deepEqual(Object.keys(loadGenres().genres), ["재즈", "팝", "록"]);

  const text = fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8");
  assert.match(text, /# 록 메모[\s\S]*록:/, "쌍을 옮겨도 그 위 주석은 붙어 있어야 한다");
});

test("차례가 그대로면 파일을 건드리지 않는다", () => {
  // 블록 표기로 적는다 — YAML 라이브러리가 인라인 표기의 공백을 정규화하므로(`[pop]` → `[ pop ]`)
  // 실제 설정 파일도 블록 표기를 쓴다. 그래야 대시보드가 저장해도 서식이 그대로다.
  const before = ["# 머리말", "defaults:", "  prefetchCount: 1", "genres:", "  팝:", "    sources:", "      - type: keyword", "        keywords:", "          - pop", "  록:", "    sources:", "      - type: keyword", "        keywords:", "          - rock", ""].join("\n");
  write("genres", before);

  yamlStore.save("genres", loadGenres());
  assert.equal(fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8"), before, "고칠 것이 없으면 서식도 그대로여야 한다");
});

// 회귀 대상: 목록을 통째로 갈아끼워서, 한 줄만 고쳐도 그 목록 안의 주석이 전부 날아갔다.
// status.yaml은 내용이 거의 다 목록이라 이게 곧 "손으로 적은 메모가 사라진다"였다.
test("목록을 고쳐도 그 안의 주석이 남는다", () => {
  write("sample", ["messages:", "  # 평소 문구", "  - 첫째", "  - 둘째", ""].join("\n"));

  const data = loadSample();
  data.messages[1] = "고친 둘째";
  yamlStore.save("sample", data);
  assert.match(fs.readFileSync(path.join(DIR, "sample.yaml"), "utf8"), /# 평소 문구/, "고칠 때");

  const grown = loadSample();
  grown.messages.push("셋째");
  yamlStore.save("sample", grown);

  const text = fs.readFileSync(path.join(DIR, "sample.yaml"), "utf8");
  assert.match(text, /# 평소 문구/, "늘릴 때");
  assert.match(text, /셋째/);
  assert.match(text, /고친 둘째/);
});

test("사라진 키는 지워진다", () => {
  write("genres", "defaults: {}\ngenres:\n  pop:\n    label: 팝\n  rock:\n    label: 록\n");
  const data = loadGenres();
  delete data.genres.rock;
  yamlStore.save("genres", data);

  assert.doesNotMatch(fs.readFileSync(path.join(DIR, "genres.yaml"), "utf8"), /rock:/);
});

test("저장하면 다음 읽기가 새 값을 가져온다", () => {
  write("genres", "defaults:\n  prefetchCount: 1\ngenres:\n  pop:\n    label: 팝\n");
  assert.equal(loadGenres().defaults.prefetchCount, 1);

  const data = loadGenres();
  data.defaults.prefetchCount = 3;
  yamlStore.save("genres", data);

  assert.equal(loadGenres().defaults.prefetchCount, 3, "읽어 둔 것을 그대로 돌려주면 안 된다");
});

// 저장하면 서버가 보낸 차례대로 파일을 줄 세운다. 대시보드가 보내는 차례와 예시 파일이
// 어긋나면, 새로 깐 사람이 한 번 저장하는 순간 주석과 값이 뒤섞인다.
test("대시보드가 보내는 키 차례와 ai.example.yaml 의 차례가 같다", () => {
  const root = path.join(import.meta.dirname, "..", "..");
  const vue = fs.readFileSync(path.join(root, "dashboard/src/components/ConfigAI.vue"), "utf8");
  const at = vue.indexOf("const KEY_ORDER = [");
  assert.ok(at > 0, "ConfigAI.vue 에 KEY_ORDER 가 있어야 한다");
  const sending = JSON.parse(vue.slice(vue.indexOf("[", at), vue.indexOf("]", at) + 1));

  const example = fs.readFileSync(path.join(root, "config/ai.example.yaml"), "utf8");
  const inFile = example
    .split("\n")
    .filter((line) => /^[a-zA-Z]/.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));

  assert.deepEqual(sending, inFile);
});

// 키 파일(ai-keys)은 소유자만 읽고 쓴다(Windows 는 이 권한 비트를 쓰지 않는다)
test("비밀 파일로 저장하면 소유자만 읽고 쓴다", { skip: process.platform === "win32" }, () => {
  fs.writeFileSync(path.join(DIR, "ai-keys.yaml"), "openai: old\n", { mode: 0o644 });
  yamlStore.save("ai-keys", { openai: "new" }, { secret: true });
  assert.equal(fs.statSync(path.join(DIR, "ai-keys.yaml")).mode & 0o777, 0o600);
});
