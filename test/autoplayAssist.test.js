"use strict";

// src/autoplayAssist.js — 자동재생 AI 보조.
//
// 이 기능의 계약은 "맞히는 것"이 아니라 **없어도 돌아가는 것**이다.
// 모델이 죽든, 느리든, 헛소리를 하든 자동재생이 멈추면 안 된다. 그 경계만 못 박는다.
// (판정 품질 자체는 모델과 프롬프트의 몫이고 notes/research-autoplay-quality.md 에서 쟀다.)

// config.js 는 require 시점에 .env 를 굳힌다 — 그 전에 넣어야 한다
process.env.AI_API_KEY = "sk-test-do-not-log";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const configData = require("../src/configDataLoader");
const assist = require("../src/autoplayAssist");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-ai-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

// 설정을 갈아끼운다. _setConfigDir 가 읽어 둔 것을 버리므로 같은 이름을 몇 번이고 바꿔 쓸 수 있다.
function useConfig(yaml) {
  fs.writeFileSync(path.join(DIR, "ai.yaml"), yaml);
  configData._setConfigDir(DIR);
}

const ON = `enabled: true
baseUrl: http://127.0.0.1:11434/v1
model: test-model
timeoutMs: 5000
batchSize: 10
`;

// fetch 를 갈아끼운다 — 진짜로 나가면 테스트가 남의 서버에 기댄다
const calls = [];
const realFetch = global.fetch;
after(() => {
  global.fetch = realFetch;
});

function answers(reply) {
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (typeof reply === "function") return reply();
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
}

const cand = (title, durationSec = 200) => ({ title, durationSec });

// ── 꺼져 있을 때 ──────────────────────────────────────────────────────────

test("꺼져 있으면 아예 부르지 않는다", async () => {
  useConfig("enabled: false\n");
  calls.length = 0;
  answers("[]");

  const list = [cand("A"), cand("B")];
  assert.equal(await assist.filter(list, { genre: "록" }), list, "받은 목록 그대로");
  assert.equal(await assist.accepts(list[0], { genre: "록" }), true);
  assert.equal(calls.length, 0, "요청이 나가면 안 된다");
});

// 반만 맞는 설정으로 부르면 매번 실패하고 로그만 쌓인다. 아예 켜지 않는다.
test("설정이 어긋나면 켜지지 않는다", async () => {
  useConfig("enabled: true\nbaseUrl: \nmodel: \n");
  calls.length = 0;
  answers("[]");

  assert.equal(assist.settings(), null);
  assert.equal(await assist.accepts(cand("A"), {}), true);
  assert.equal(calls.length, 0);
});

// ── 판정 ─────────────────────────────────────────────────────────────────

test("아니라고 하면 버린다 — 한 곡을 물었을 때", async () => {
  useConfig(ON);
  answers('[{"n":1,"song":false,"fits":true}]');
  assert.equal(await assist.accepts(cand("Pop Hits 2021 믹스", 3600), { genre: "팝" }), false);

  answers('[{"n":1,"song":true,"fits":false}]');
  assert.equal(await assist.accepts(cand("Maroon 5 - Girls Like You"), { genre: "로파이" }), false);

  answers('[{"n":1,"song":true,"fits":true}]');
  assert.equal(await assist.accepts(cand("System Of A Down - Toxicity"), { genre: "록" }), true);
});

test("목록에서는 아니라고 한 것만 뺀다", async () => {
  useConfig(ON);
  answers('[{"n":1,"song":true,"fits":true},{"n":2,"song":false,"fits":true},{"n":3,"song":true,"fits":true}]');

  const list = [cand("좋은 곡"), cand("1시간 믹스"), cand("다른 곡")];
  const kept = await assist.filter(list, { genre: "록" });
  assert.deepEqual(
    kept.map((one) => one.title),
    ["좋은 곡", "다른 곡"],
  );
});

// 모델이 유난히 박한 날 곡이 하나도 안 남으면 자동재생이 멈춘다. 그럴 바엔 규칙이 고른 것을 쓴다.
test("전부 떨어지면 규칙이 고른 것을 그대로 쓴다", async () => {
  useConfig(ON);
  answers('[{"n":1,"song":false,"fits":false},{"n":2,"song":false,"fits":false}]');

  const list = [cand("A"), cand("B")];
  assert.equal(await assist.filter(list, { genre: "록" }), list);
});

test("답을 못 받은 자리는 살린다", async () => {
  useConfig(ON);
  // 2번을 빠뜨린 답 — 작은 모델이 곧잘 이런다
  answers('[{"n":1,"song":true,"fits":true},{"n":3,"song":true,"fits":true}]');

  const kept = await assist.filter([cand("A"), cand("B"), cand("C")], {});
  assert.equal(kept.length, 3, "빠진 자리를 떨어뜨리면 안 된다");
});

// ── 모델이 말을 안 들을 때 ────────────────────────────────────────────────

test("모델이 죽어도 자동재생은 돈다", async () => {
  useConfig(ON);
  const list = [cand("A"), cand("B")];

  for (const broken of [
    () => {
      throw new Error("fetch failed");
    },
    () => ({ ok: false, status: 500, text: async () => "boom" }),
    () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "죄송합니다, 판단할 수 없습니다." } }] }) }),
    () => ({ ok: true, json: async () => ({}) }),
  ]) {
    answers(broken);
    assert.equal(await assist.filter(list, {}), list, "목록은 그대로");
    assert.equal(await assist.accepts(list[0], {}), true, "한 곡은 살린다");
  }
});

// 어떤 서비스는 거절 응답에 보낸 헤더를 되비춘다. 그 본문을 오류에 실으면 로그에 키가 남는다.
test("오류 어디에도 키가 나오지 않는다", async () => {
  useConfig(ON);
  answers(() => ({ ok: false, status: 401, text: async () => `Invalid key: ${process.env.AI_API_KEY}` }));

  const seen = [];
  const log = require("../src/logger");
  const realDebug = log.debug;
  const child = log.child;
  log.child = () => ({ ...log, debug: (line) => seen.push(String(line)) });
  delete require.cache[require.resolve("../src/autoplayAssist")];
  const fresh = require("../src/autoplayAssist");

  await fresh.accepts(cand("A"), {});
  log.child = child;
  log.debug = realDebug;

  assert.ok(seen.length, "무슨 일이 있었는지는 남겨야 한다");
  for (const line of seen) assert.ok(!line.includes(process.env.AI_API_KEY), `로그에 키가 남았다: ${line}`);
});

// ── 요청 모양 ────────────────────────────────────────────────────────────

test("설정한 것이 그대로 요청에 실린다", async () => {
  useConfig(`${ON}temperature: 0.4\nextra:\n  think: false\n  reasoning_effort: low\nprompt:\n  - role: system\n    text: 내가 쓴 기준\n  - role: user\n    text: "{{목록}}"\n`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), { genre: "록" });
  const sent = calls.at(-1);
  assert.equal(sent.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(sent.body.model, "test-model");
  assert.equal(sent.body.temperature, 0.4);
  assert.equal(sent.body.think, false, "서비스마다 다른 값은 extra 로 그대로 얹는다");
  assert.equal(sent.body.reasoning_effort, "low");
  assert.equal(sent.body.messages[0].content, "내가 쓴 기준", "프롬프트를 적었으면 그것을 쓴다");
  assert.match(sent.body.messages[1].content, /장르=록/);
  assert.equal(sent.init.headers.Authorization, `Bearer ${process.env.AI_API_KEY}`);
});

test("프롬프트를 안 적으면 기본 구성을 쓴다", async () => {
  useConfig(ON);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  const sent = calls.at(-1).body.messages;
  assert.equal(sent.length, 2);
  assert.equal(sent[0].role, "system");
  assert.equal(sent[0].content, assist.DEFAULT_PROMPT);
  assert.equal(sent[1].role, "user");
});

// ── 대화 구성 ────────────────────────────────────────────────────────────

test("섹션마다 역할을 정해 적은 차례대로 보낸다", async () => {
  useConfig(`${ON}prompt:
  - role: system
    text: 기준이다
  - role: assistant
    text: 알겠다
  - role: user
    text: |
      아래를 판정해라
      {{목록}}
`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  const sent = calls.at(-1).body.messages;
  assert.deepEqual(
    sent.map((one) => one.role),
    ["system", "assistant", "user"],
  );
  assert.equal(sent[0].content, "기준이다");
  assert.match(sent[2].content, /^아래를 판정해라\n1\. 장르=록 길이=3분 제목=Toxicity/);
});

test("{{목록}} 자리에 후보가 들어간다 — 어느 역할이든", async () => {
  useConfig(`${ON}prompt:
  - role: system
    text: "기준. 목록: {{목록}} 끝."
`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true},{"n":2,"song":true,"fits":true}]');

  await assist.filter([cand("A", 60), cand("B", 120)], { genre: "록" });
  const sent = calls.at(-1).body.messages;
  assert.equal(sent.length, 1, "섹션이 하나면 메시지도 하나다");
  assert.equal(sent[0].content, "기준. 목록: 1. 장르=록 길이=1분 제목=A\n2. 장르=록 길이=2분 제목=B 끝.");
});

test("내용이 빈 섹션은 보내지 않는다", async () => {
  useConfig(`${ON}prompt:
  - role: system
    text: 기준이다
  - role: assistant
    text: "   "
  - role: user
    text: "{{목록}}"
`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  assert.equal(calls.at(-1).body.messages.length, 2);
});

// ── 후보 목록의 모양 ──────────────────────────────────────────────────────

test("줄 형식을 직접 짤 수 있다", async () => {
  useConfig(`${ON}list:
  lineFormat: "{{번호}}) {{제목}} [{{길이초}}s]"
prompt:
  - role: user
    text: "{{목록}}"
`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  assert.equal(calls.at(-1).body.messages[0].content, "1) Toxicity [210s]");
});

// 길이를 모르는데 "0분"이라고 적으면 모델에게 거짓을 알려 주는 것이다.
test("길이를 모르는 후보 — 낱말째 빼거나, 글자로 적거나, 0으로", async () => {
  const unknown = { title: "이름만 아는 곡" };
  const ask = async (yaml) => {
    useConfig(`${ON}${yaml}prompt:\n  - role: user\n    text: "{{목록}}"\n`);
    calls.length = 0;
    answers('[{"n":1,"song":true,"fits":true}]');
    await assist.accepts(unknown, { genre: "록" });
    return calls.at(-1).body.messages[0].content;
  };

  assert.equal(await ask(""), "1. 장르=록 제목=이름만 아는 곡", "기본은 길이 칸을 통째로 뺀다");
  assert.equal(await ask("list:\n  unknownDuration: text\n  unknownText: 모름\n"), "1. 장르=록 길이=모름분 제목=이름만 아는 곡");
  assert.equal(await ask("list:\n  unknownDuration: zero\n"), "1. 장르=록 길이=0분 제목=이름만 아는 곡");

  // 아는 후보는 어느 설정에서도 그대로다
  useConfig(ON);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');
  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  assert.equal(calls.at(-1).body.messages[1].content, "1. 장르=록 길이=3분 제목=Toxicity");
});

// 미리보기가 실제와 다르면 보여 주는 뜻이 없다 — 같은 조립 코드를 쓴다
test("미리보기는 실제로 나갈 요청과 같은 것을 만든다", async () => {
  const cfg = { enabled: true, baseUrl: "http://127.0.0.1:11434/v1/", model: "test-model", temperature: 0, extra: { think: false } };
  const shown = assist.preview(cfg, "록");

  assert.equal(shown.url, "http://127.0.0.1:11434/v1/chat/completions", "끝의 빗금은 정리한다");
  assert.equal(shown.body.think, false);
  assert.equal(typeof shown.hasKey, "boolean");
  assert.ok(!JSON.stringify(shown).includes(process.env.AI_API_KEY), "키 값은 나가지 않는다");

  // 보기 곡 셋 중 하나는 길이를 모르는 것이다 — 그 처리를 눈으로 보라고 넣었다
  const asked = shown.body.messages.at(-1).content;
  assert.equal(asked.split("\n").length, 3);
  assert.match(asked, /^3\. 장르=록 제목=/m, "길이를 모르는 줄은 그 칸이 빠진다");
});

test("묶음 크기대로 나눠 묻는다", async () => {
  useConfig(`${ON.replace("batchSize: 10", "batchSize: 2")}`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true},{"n":2,"song":true,"fits":true}]');

  await assist.filter([cand("A"), cand("B"), cand("C"), cand("D"), cand("E")], {});
  assert.equal(calls.length, 3, "5개를 2개씩 — 세 번");
});

// 업로더 이름은 일부러 안 넘긴다. 넣어 봤더니 fits 가 94% → 88% 로 떨어졌다
// (유튜브의 그 칸은 대개 채널 이름이다: Vevo · Radio Mix).
test("업로더 이름은 넘기지 않는다", async () => {
  useConfig(ON);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts({ title: "Girls Like You", durationSec: 200, channel: "Maroon5VEVO", artist: "Vevo" }, { genre: "팝" });
  const asked = calls.at(-1).body.messages[1].content;
  assert.ok(!asked.includes("Vevo"), asked);
  assert.ok(!asked.includes("Maroon5VEVO"), asked);
});

// ── 경로에 실제로 붙어 있는가 ─────────────────────────────────────────────

// 모듈이 멀쩡해도 배선이 빠지면 아무 일도 안 일어난다. 그 배선이 조용히 풀리는 것을 막는다.
test("키워드 경로에서만 묻는다", async () => {
  const route = require("../src/autoplayRoute");
  const limits = require("../src/autoplayFilter").prepare({ minDurationSec: 0, maxDurationSec: null, blockedKeywords: [] });
  const fromSearch = { title: "Pop Hits 2021 믹스", durationSec: 3600, youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", fromSearch: true, sourceKey: "yt:aaaaaaaaaaa" };

  useConfig(ON);
  answers('[{"n":1,"song":false,"fits":true}]');
  assert.equal(await route.resolve(fromSearch, limits, "팝"), null, "여러 곡이라고 하면 버린다");

  answers('[{"n":1,"song":true,"fits":true}]');
  assert.ok(await route.resolve(fromSearch, limits, "팝"), "괜찮다고 하면 튼다");

  answers(() => {
    throw new Error("연결 실패");
  });
  assert.ok(await route.resolve(fromSearch, limits, "팝"), "모델이 죽어도 규칙만으로 튼다");

  // 주소를 직접 주는 소스(VocaDB·재생목록)는 출처가 곧 정답이라 물을 것이 없다
  calls.length = 0;
  answers('[{"n":1,"song":false,"fits":false}]');
  const direct = { ...fromSearch, fromSearch: undefined, platform: "vocadb", sourceUrl: "https://vocadb.net/S/1" };
  assert.ok(await route.resolve(direct, limits, "팝"), "아니라고 해도 영향을 받지 않는다");
  assert.equal(calls.length, 0, "애초에 묻지 않는다");
});

test("규칙이 확신하면 묻지 않는다", async () => {
  useConfig(ON);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  assert.equal(await assist.accepts(cand("A"), { confident: true }), true);
  assert.equal(calls.length, 0);

  // skipConfident 를 끄면 확신해도 묻는다
  useConfig(`${ON}skipConfident: false\n`);
  await assist.accepts(cand("A"), { confident: true });
  assert.equal(calls.length, 1);
});
