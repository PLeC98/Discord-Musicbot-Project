"use strict";

// src/autoplayAssist.js — 자동재생 AI 보조.
//
// 이 기능의 계약은 "맞히는 것"이 아니라 **없어도 돌아가는 것**이다.
// 모델이 죽든, 느리든, 헛소리를 하든 자동재생이 멈추면 안 된다. 그 경계만 못 박는다.
// (판정 품질 자체는 모델과 프롬프트의 몫이고 notes/research-autoplay-quality.md 에서 쟀다.)

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
//
// 프롬프트는 **딴 파일**이다(config/ai-prompt.chatml) — 설정 파일에는 안 섞는다.
// 키도 설정 파일에 있다(config/ai-keys.yaml). 프로바이더마다 따로다.
const KEY = "sk-test-do-not-log";
// 버텍스는 키가 아니라 서비스 계정 JSON 을 쓴다 — 진짜 키라야 서명이 통과한다
const { privateKey: PRIVATE_KEY } = require("node:crypto").generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA_PATH = path.join(DIR, "vertex-sa.json").replace(/\\/g, "/");
fs.writeFileSync(SA_PATH, JSON.stringify({ client_email: "bot@p.iam.gserviceaccount.com", private_key: PRIVATE_KEY, project_id: "json-프로젝트" }));

function useConfig(yaml, sections) {
  fs.writeFileSync(path.join(DIR, "ai.yaml"), yaml);
  fs.writeFileSync(path.join(DIR, "ai-keys.yaml"), `openai: ${KEY}\ncustom: ${KEY}\nanthropic: ${KEY}\naistudio: ${KEY}\nvertex: ${SA_PATH}\n`);
  if (sections === undefined) fs.rmSync(path.join(DIR, "ai-prompt.chatml"), { force: true });
  else fs.writeFileSync(path.join(DIR, "ai-prompt.chatml"), configData.toChatML(sections));
  configData._setConfigDir(DIR);
}

// 설정 폴더를 쓰지 않는 호출(preview·ping·listModels)도 키를 보게 해 둔다
useConfig("provider: off\n");

const ON = `provider: custom
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
  useConfig("provider: off\n");
  calls.length = 0;
  answers("[]");

  const list = [cand("A"), cand("B")];
  assert.equal(await assist.filter(list, { genre: "록" }), list, "받은 목록 그대로");
  assert.equal(await assist.accepts(list[0], { genre: "록" }), true);
  assert.equal(calls.length, 0, "요청이 나가면 안 된다");
});

// 반만 맞는 설정으로 부르면 매번 실패하고 로그만 쌓인다. 아예 켜지 않는다.
test("설정이 어긋나면 켜지지 않는다", async () => {
  useConfig("provider: custom\nbaseUrl: \nmodel: \n");
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
  answers(() => ({ ok: false, status: 401, text: async () => `Invalid key: ${KEY}` }));

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
  for (const line of seen) assert.ok(!line.includes(KEY), `로그에 키가 남았다: ${line}`);
});

// ── 요청 모양 ────────────────────────────────────────────────────────────

test("설정한 것이 그대로 요청에 실린다", async () => {
  useConfig(`${ON}temperature: 0.4\nextra: |\n  think=false\n  reasoning_effort=low\n`, [
    { role: "system", text: "내가 쓴 기준" },
    { role: "user", text: "{{목록}}" },
  ]);
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
  assert.equal(sent.init.headers.Authorization, `Bearer ${KEY}`);
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
  useConfig(ON, [
    { role: "system", text: "기준이다" },
    { role: "assistant", text: "알겠다" },
    { role: "user", text: "아래를 판정해라\n{{목록}}" },
  ]);
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
  useConfig(ON, [{ role: "system", text: "기준. 목록: {{목록}} 끝." }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true},{"n":2,"song":true,"fits":true}]');

  await assist.filter([cand("A", 60), cand("B", 120)], { genre: "록" });
  const sent = calls.at(-1).body.messages;
  assert.equal(sent.length, 1, "섹션이 하나면 메시지도 하나다");
  assert.equal(sent[0].content, "기준. 목록: 1. 장르=록 길이=1분 제목=A\n2. 장르=록 길이=2분 제목=B 끝.");
});

test("내용이 빈 섹션은 보내지 않는다", async () => {
  useConfig(ON, [
    { role: "system", text: "기준이다" },
    { role: "assistant", text: "   " },
    { role: "user", text: "{{목록}}" },
  ]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  assert.equal(calls.at(-1).body.messages.length, 2);
});

// ── 후보 목록의 모양 ──────────────────────────────────────────────────────

test("줄 형식을 직접 짤 수 있다", async () => {
  useConfig(`${ON}list:\n  lineFormat: "{{번호}}) {{제목}} [{{길이초}}s]"\n`, [{ role: "user", text: "{{목록}}" }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  assert.equal(calls.at(-1).body.messages[0].content, "1) Toxicity [210s]");
});

// 길이를 모르는데 "0분"이라고 적으면 모델에게 거짓을 알려 주는 것이다.
test("길이를 모르는 후보 — 낱말째 빼거나, 글자로 적거나, 0으로", async () => {
  const unknown = { title: "이름만 아는 곡" };
  const ask = async (yaml) => {
    useConfig(`${ON}${yaml}`, [{ role: "user", text: "{{목록}}" }]);
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

// ── 추가 파라미터 ─────────────────────────────────────────────────────────

// 서비스마다 이름도 자리도 달라 글로 받는다. RisuAI 와 같은 입력법이다.
test("추가 파라미터 — 값·JSON·헤더·빼기", () => {
  const got = assist.parseExtra(["think=false", "reasoning_effort=low", "top_p=0.9", 'response_format=json::{"type":"json_object"}', "header::X-Title=Discord Musicbot", "temperature={{none}}", "# 주석은 건너뛴다", "", "이름없음"].join("\n"));

  assert.deepEqual(got.body, { think: false, reasoning_effort: "low", top_p: 0.9, response_format: { type: "json_object" } });
  assert.deepEqual(got.headers, { "X-Title": "Discord Musicbot" });
  assert.deepEqual(got.drop, ["temperature"]);
  assert.deepEqual(got.problems, ["이름이 없습니다: 이름없음"]);
});

// **점 표기가 없으면 추론 레벨을 여기로 우회할 수 없다.** 키 이름이 통째로 들어가 조용히 무시됐다.
test("추가 파라미터 — 점 표기로 안쪽 칸에 넣는다", () => {
  const got = assist.parseExtra(["thinking.budget_tokens=1024", "thinking.type=enabled", "generationConfig.thinkingConfig.thinkingLevel=high"].join("\n"));

  assert.deepEqual(got.body, {
    thinking: { budget_tokens: 1024, type: "enabled" },
    generationConfig: { thinkingConfig: { thinkingLevel: "high" } },
  });
});

// 값을 어떻게 읽을지. 따옴표로 두르면 숫자처럼 보여도 글자다.
test("추가 파라미터 — 값의 꼴", () => {
  const got = assist.parseExtra(['seed="123"', "stop=null", "n=2", "flag=true", "name=그냥 글자", 'cfg=json::{"a":True,"b":None}'].join("\n"));

  assert.equal(got.body.seed, "123", "따옴표를 벗기고 글자로 둔다");
  assert.equal(got.body.stop, null);
  assert.equal(got.body.n, 2);
  assert.equal(got.body.flag, true);
  assert.equal(got.body.name, "그냥 글자");
  assert.deepEqual(got.body.cfg, { a: true, b: null }, "파이썬 꼴 키워드도 읽는다");
});

// 조용히 버리면 "왜 안 먹지"가 된다. 못 읽은 줄은 돌려줘서 화면이 보여 준다.
test("추가 파라미터 — 못 읽은 줄을 알려 준다", () => {
  const got = assist.parseExtra(["cfg=json::{깨짐", "empty=", "ok=1"].join("\n"));

  assert.deepEqual(got.body, { ok: 1 }, "멀쩡한 줄은 살린다");
  assert.equal(got.problems.length, 2);
  assert.match(got.problems.join(" "), /JSON 으로 못 읽었습니다: cfg/);
  assert.match(got.problems.join(" "), /값이 없습니다: empty/);
});

// {{none}} 을 header:: 보다 먼저 봐야 한다 — 반대로 보면 헤더에 "{{none}}" 을 넣게 된다.
test("헤더도 {{none}} 으로 지운다", async () => {
  useConfig(`${ON}extra: |\n  header::Authorization={{none}}\n  header::X-Title=지움 확인\n`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  const sent = calls.at(-1);
  assert.equal(sent.init.headers.Authorization, undefined, "지우라고 한 헤더는 안 나간다");
  assert.equal(sent.init.headers["X-Title"], "지움 확인", "나머지 헤더는 그대로");
});

test("헤더와 {{none}} 이 실제 요청에 반영된다", async () => {
  useConfig(`${ON}extra: |\n  header::X-Title=Musicbot\n  temperature={{none}}\n  top_p=0.5\n`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  const sent = calls.at(-1);
  assert.equal(sent.init.headers["X-Title"], "Musicbot");
  assert.ok(!("temperature" in sent.body), "{{none}} 은 아예 안 보낸다");
  assert.equal(sent.body.top_p, 0.5);
});

// ── 프롬프트 파일(ChatML) ─────────────────────────────────────────────────

test("ChatML 로 읽고 쓴다 — 왕복해도 같다", () => {
  const text = `<|im_start|>system\n기준이다\n여러 줄\n<|im_end|>\n\n<|im_start|>user\n{{목록}}\n<|im_end|>\n`;
  const parsed = configData.parseChatML(text);

  assert.deepEqual(parsed, [
    { role: "system", text: "기준이다\n여러 줄" },
    { role: "user", text: "{{목록}}" },
  ]);
  assert.equal(configData.toChatML(parsed), text);
  assert.deepEqual(configData.parseChatML(configData.toChatML(parsed)), parsed);

  // 블록 바깥의 글은 규격에 자리가 없다
  assert.deepEqual(configData.parseChatML("앞말\n<|im_start|>user\n하나\n<|im_end|>\n뒷말"), [{ role: "user", text: "하나" }]);
  assert.deepEqual(configData.parseChatML(""), []);
});

test("프롬프트 파일이 없으면 기본 구성으로 돈다", async () => {
  useConfig(ON); // 프롬프트 파일을 안 만든다
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  assert.equal(calls.at(-1).body.messages[0].content, assist.DEFAULT_PROMPT);
});

// ── 미리보기 ─────────────────────────────────────────────────────────────

const DRAFT = { provider: "custom", baseUrl: "http://127.0.0.1:11434/v1/", model: "test-model", temperature: 0, extra: "think=false" };

// **미리보기는 아무 데도 안 나간다.** 테스트만 실제로 보낸다 — 둘을 섞으면
// "키도 안 넣었는데 왜 응답이 오지"가 된다.
test("미리보기는 만들기만 하고 보내지 않는다", async () => {
  calls.length = 0;
  answers("[]");

  const shown = await assist.preview(DRAFT, "록");
  assert.equal(calls.length, 0, "요청이 나가면 안 된다");
  assert.equal(shown.url, "http://127.0.0.1:11434/v1/chat/completions", "끝의 빗금은 정리한다");
  assert.equal(shown.body.think, false);
  assert.ok(!("response" in shown), "보내지 않았으니 응답 칸이 없다");

  // 키 값은 화면으로 가지 않는다 — 있었다는 표시만 남긴다
  assert.equal(shown.headers.Authorization, "Bearer [REDACTED_SECRET_KEY]");
  assert.ok(!JSON.stringify(shown).includes(KEY));

  // 보기 곡 셋 중 하나는 길이를 모르는 것이다 — 그 처리를 눈으로 보라고 넣었다
  const asked = shown.body.messages.at(-1).content;
  assert.equal(asked.split("\n").length, 3);
  assert.match(asked, /^3\. 장르=록 제목=/m, "길이를 모르는 줄은 그 칸이 빠진다");
});

test("테스트는 실제로 보내고 나간 것·온 것을 그대로 준다", async () => {
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"[]"}}]}' };
  };

  const shown = await assist.sendTest(DRAFT, "록");
  assert.equal(calls.length, 1, "한 번 나간다");
  assert.equal(shown.status, 200);
  assert.match(shown.response, /choices/, "응답은 손대지 않고 그대로 준다");
  assert.equal(shown.headers.Authorization, "Bearer [REDACTED_SECRET_KEY]");
});

test("테스트는 못 보내도 던지지 않는다", async () => {
  global.fetch = async () => {
    throw new Error("연결 실패");
  };
  const shown = await assist.sendTest({ provider: "openai", baseUrl: "http://x/v1", model: "m" });
  assert.equal(shown.status, null);
  assert.match(shown.response, /연결 실패/);
});

// 거절 응답에 보낸 값을 되비추는 서비스가 있다 — 화면에도 로그에도 키가 남으면 안 된다
test("응답에 키가 섞여 와도 가려서 준다", async () => {
  global.fetch = async () => ({ ok: false, status: 401, text: async () => `bad key: ${KEY}` });

  const shown = await assist.sendTest({ provider: "openai", baseUrl: "http://x/v1", model: "m" });
  assert.equal(shown.status, 401);
  assert.ok(!shown.response.includes(KEY), shown.response);
  // 별표만 있으면 원래 그런 값인 줄 안다 — 무엇이 가려졌는지 이름을 붙인다
  assert.ok(shown.response.includes(assist.REDACTED), shown.response);
});

// ── 오류를 그대로 보여준다 ────────────────────────────────────────────────

// 왜 거절됐는지는 본문에만 있다(모델 이름 오타 · 사용량 초과 …). 상태 코드만으론 못 고친다.
test("확인 실패는 상태 코드와 본문을 그대로 전한다", async () => {
  global.fetch = async () => ({ ok: false, status: 429, text: async () => '{"error":"rate limit exceeded"}' });

  const got = await assist.listModels({ provider: "openai", baseUrl: "http://x/v1" });
  assert.equal(got.ok, false);
  assert.match(got.reason, /429/);
  assert.match(got.response, /rate limit exceeded/);

  assert.match((await assist.listModels({ provider: "off" })).reason, /provider=off/, "왜 안 도는지도 그대로 말한다");
});

// ── 무료 확인(모델 목록)과 유료 확인(짧은 생성) ───────────────────────────

// 연결만 보고 싶은데 판정 프롬프트를 통째로 보내면 토큰도 들고,
// "연결이 안 되는 것"과 "판정을 못 읽은 것"이 섞인다.
test("무료 확인은 모델 목록만 받는다 — 추론이 없다", async () => {
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{"data":[{"id":"gemma3n:e2b"},{"id":"qwen3:8b"}]}' };
  };

  // 적어 둔 baseUrl 은 무시되고 ollama 에 박힌 주소로 간다
  const got = await assist.listModels({ provider: "ollama", baseUrl: "http://엉뚱한곳/v1" });
  assert.equal(got.ok, true);
  assert.deepEqual(got.models, ["gemma3n:e2b", "qwen3:8b"]);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/models");
  assert.equal(calls[0].init.method, undefined, "GET 이다 — 생성이 아니다");
  // 로컬 프로바이더는 키를 안 보낸다
  assert.ok(!calls[0].init.headers.Authorization, "로컬에는 키를 안 붙인다");
});

// 주소는 프로바이더에 박힌 것을 쓴다 — 설정에 남아 있는 옛 주소로 조용히 나가지 않는다.
test("baseUrl 은 custom 일 때만 쓴다", () => {
  assert.equal(assist.endpointOf({ provider: "openai", baseUrl: "http://엉뚱한곳/v1" }), "https://api.openai.com/v1");
  assert.equal(assist.endpointOf({ provider: "ollama", baseUrl: "http://엉뚱한곳/v1" }), "http://127.0.0.1:11434/v1");
  assert.equal(assist.endpointOf({ provider: "custom", baseUrl: "https://plec.moe/anthropic/v1/" }), "https://plec.moe/anthropic/v1", "끝의 빗금은 정리한다");
  assert.equal(assist.endpointOf({ provider: "custom", baseUrl: "" }), "");
  assert.equal(assist.endpointOf({ provider: "모름" }), "");

  // 같은 이름이라도 로컬과 클라우드는 다른 곳이다
  assert.notEqual(assist.PROVIDER_SPECS.ollama.baseUrl, assist.PROVIDER_SPECS["ollama-cloud"].baseUrl);
  assert.equal(assist.PROVIDER_SPECS.ollama.key, false, "내 기기에는 키를 안 붙인다");
  assert.equal(assist.PROVIDER_SPECS["ollama-cloud"].key, true);
});

// 키 칸 이름은 provider 이름과 같아야 한다. 어긋나면 키를 적어 두고도 안 붙어 나간다.
test("키가 필요한 프로바이더는 예제 키 파일에 칸이 있다", () => {
  const example = require("yaml").parse(fs.readFileSync(path.join(__dirname, "..", "config", "ai-keys.example.yaml"), "utf8"));
  const slots = Object.keys(example);
  const needs = assist.PROVIDERS.filter((one) => assist.PROVIDER_SPECS[one].key);

  assert.deepEqual(
    needs.filter((one) => !slots.includes(one)),
    [],
    "키가 필요한데 적을 칸이 없다",
  );
  assert.deepEqual(
    slots.filter((one) => !needs.includes(one)),
    [],
    "칸은 있는데 쓰는 곳이 없다",
  );
});

// 미리보기·테스트는 **저장 안 한 초안**을 그대로 받는다. custom 은 주소를 사람이 적으므로,
// 그 주소로 키까지 붙여 보내면 운영자 세션을 쥔 쪽이 저장도 없이 아무 데로나 키를 흘릴 수 있다.
test("custom 은 저장된 주소와 같을 때만 키를 붙인다", async () => {
  useConfig("provider: custom\nbaseUrl: https://내가저장한곳/v1\nmodel: m\n");
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "{}" };
  };

  await assist.ping({ provider: "custom", baseUrl: "https://공격자/v1", model: "m" });
  assert.ok(!calls.at(-1).init.headers.Authorization, "저장 안 한 주소에는 키를 안 붙인다");

  await assist.ping({ provider: "custom", baseUrl: "https://내가저장한곳/v1", model: "m" });
  assert.equal(calls.at(-1).init.headers.Authorization, `Bearer ${KEY}`, "저장된 주소면 붙인다");

  // 주소가 박힌 프로바이더는 애초에 초안이 주소를 못 바꾼다
  await assist.ping({ provider: "openai", baseUrl: "https://공격자/v1", model: "m" });
  assert.equal(calls.at(-1).url, "https://api.openai.com/v1/chat/completions");
});

// 모델 이름은 코드에 안 적는다. 대신 안 쓸 것을 설정에서 가린다 —
// 저쪽 목록에는 영상·이미지 모델이나 한참 옛 모델이 섞여 나온다.
test("모델 목록에서 가릴 것을 설정으로 정한다", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: [{ id: "gpt-5" }, { id: "sora-2" }, { id: "gpt-3.5-turbo" }, { id: "nano-banana-pro-preview" }, { id: "text-embedding-3-small" }] }),
  });

  const got = await assist.listModels({ provider: "openai", hideModels: ["*sora*", "gpt-3.5*", "*banana*", "*embedding*"] });
  assert.deepEqual(got.models, ["gpt-5"]);
  assert.equal(got.hiddenCount, 4, "몇 개를 가렸는지 알려 준다 — 조용히 사라지면 안 된다");

  // 안 적으면 그대로 다 온다
  assert.equal((await assist.listModels({ provider: "openai" })).models.length, 5);

  // 글롭이지 정규식이 아니다 — 점은 점이다
  const dots = await assist.listModels({ provider: "openai", hideModels: ["gpt.5"] });
  assert.ok(dots.models.includes("gpt-5"), "gpt.5 가 gpt-5 를 가리면 안 된다");
});

// ── 앤트로픽 네이티브 ─────────────────────────────────────────────────────

// OpenAI 와 다른 것 셋: system 이 본문 맨 위 칸, max_tokens 가 필수, 인증이 x-api-key.
test("앤트로픽은 네이티브 규격으로 보낸다", async () => {
  useConfig("provider: anthropic\nmodel: claude-x\ntemperature: 0\n", [
    { role: "system", text: "기준 하나" },
    { role: "system", text: "기준 둘" },
    { role: "user", text: "{{목록}}" },
  ]);
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ content: [{ type: "text", text: '[{"n":1,"song":true,"fits":true}]' }] }) };
  };

  assert.equal(await assist.accepts(cand("A"), { genre: "록" }), true, "content[].text 에서 판정을 읽는다");

  const sent = calls.at(-1);
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.init.headers["x-api-key"], KEY, "Authorization 이 아니라 x-api-key 다");
  assert.ok(!sent.init.headers.Authorization);
  assert.equal(sent.init.headers["anthropic-version"], "2023-06-01");

  assert.equal(sent.body.system, "기준 하나\n\n기준 둘", "system 은 본문 맨 위 칸으로 올리고 여럿이면 붙인다");
  assert.ok(sent.body.max_tokens > 0, "없으면 400 이다");
  assert.deepEqual(
    sent.body.messages.map((m) => m.role),
    ["user"],
    "system 은 messages 에 남지 않는다",
  );
});

test("앤트로픽 모델 목록과 max_tokens 덮어쓰기", async () => {
  useConfig("provider: anthropic\nmodel: claude-x\nextra: max_tokens=4096\n", [{ role: "user", text: "{{목록}}" }]);
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => '{"data":[{"id":"claude-opus-5"},{"id":"claude-sonnet-5"}]}', json: async () => ({ content: [{ text: "[]" }] }) };
  };

  const got = await assist.listModels({ provider: "anthropic" });
  assert.deepEqual(got.models, ["claude-opus-5", "claude-sonnet-5"]);
  assert.equal(calls.at(-1).url, "https://api.anthropic.com/v1/models");

  await assist.accepts(cand("A"), {});
  assert.equal(calls.at(-1).body.max_tokens, 4096, "모자라면 extra 로 늘린다");
});

// ── 버텍스 AI(제미니 네이티브) ────────────────────────────────────────────

// 여기만 유난히 다르다: 주소를 조립하고, 토큰으로 인증하고, 본문이 contents/parts 다.
test("버텍스는 주소를 조립하고 제미니 본문으로 보낸다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: us-central1\ntemperature: 0\n", [
    { role: "system", text: "기준이다" },
    { role: "user", text: "{{목록}}" },
  ]);
  require("../src/googleAuth")._reset();

  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: init.body && !String(url).includes("oauth2") ? JSON.parse(init.body) : null });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"n":1,"song":true,"fits":true}]' }] } }] }) };
  };

  assert.equal(await assist.accepts(cand("A"), { genre: "록" }), true, "candidates[].content.parts[].text 를 읽는다");

  const token = calls.find((one) => String(one.url).includes("oauth2"));
  assert.ok(token, "먼저 서비스 계정으로 토큰을 받는다");

  const sent = calls.at(-1);
  assert.equal(sent.url, "https://us-central1-aiplatform.googleapis.com/v1/projects/json-프로젝트/locations/us-central1/publishers/google/models/gemini-3-pro:generateContent");
  assert.equal(sent.init.headers.Authorization, "Bearer ya29.가짜");
  assert.deepEqual(sent.body.systemInstruction, { parts: [{ text: "기준이다" }] }, "system 은 딴 칸이다");
  assert.equal(sent.body.contents[0].role, "user");
  assert.ok(sent.body.contents[0].parts[0].text.includes("장르=록"));
  assert.ok(!("messages" in sent.body));
});

// **경로는 언제나 본문 맨 위부터다.** 버텍스라고 generationConfig 안으로 넣어 주지 않는다 —
// 모델 프로필의 mapsTo.path 와 같은 규칙이라야 두 길이 어긋나지 않는다.
test("버텍스: assistant 는 model 이고, 추가 파라미터는 적은 경로 그대로 간다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: global\nextra: generationConfig.topP=0.9\n", [
    { role: "assistant", text: "알겠다" },
    { role: "user", text: "{{목록}}" },
  ]);
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: init.body && !String(url).includes("oauth2") ? JSON.parse(init.body) : null });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  };

  await assist.accepts(cand("A"), {});
  const sent = calls.at(-1);
  assert.deepEqual(
    sent.body.contents.map((c) => c.role),
    ["model", "user"],
    "assistant 를 model 이라 부른다",
  );
  // 맨 위에 두면 저쪽이 조용히 무시한다 — 가장 알아채기 어려운 종류다
  assert.equal(sent.body.generationConfig.topP, 0.9);
  assert.ok(!("topP" in sent.body));
  // global 리전은 호스트가 다르다
  assert.match(sent.url, /^https:\/\/aiplatform\.googleapis\.com\//);
});

// AI 스튜디오도 제미니 네이티브다. OpenAI 호환층(/v1beta/openai)을 쓰면 추론 설정이
// 저쪽 규격과 어긋나고, 모델 프로필이 적어 둔 경로도 네이티브 기준이다.
test("AI 스튜디오는 제미니 네이티브로 보낸다", async () => {
  useConfig("provider: aistudio\nmodel: gemini-3.7-flash\nextra: generationConfig.topP=0.5\n", [
    { role: "system", text: "너는 판정기다" },
    { role: "user", text: "{{목록}}" },
  ]);
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  };

  await assist.accepts(cand("A"), {});
  const sent = calls.at(-1);

  assert.match(sent.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.7-flash:generateContent$/);
  assert.equal(sent.init.headers["x-goog-api-key"], KEY, "키는 x-goog-api-key 로 간다");
  assert.equal(sent.init.headers.Authorization, undefined, "Bearer 가 아니다");
  assert.ok(sent.body.contents, "messages 가 아니라 contents 다");
  assert.equal(sent.body.systemInstruction.parts[0].text, "너는 판정기다");
  assert.equal(sent.body.generationConfig.topP, 0.5, "추가 파라미터도 적은 경로 그대로");
});

// 모델 목록은 생성과 **주소 체계가 다르다**(프로젝트·리전이 안 붙는다).
// 생성 주소를 그대로 썼다가 404 를 봤다. 문서판이 갈려 있어 차례로 물어본다.
test("버텍스 모델 목록: 404 면 다음 주소로 넘어간다", async () => {
  const tried = [];
  global.fetch = async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    tried.push(String(url));
    if (tried.length < 2) return { ok: false, status: 404, text: async () => '{"error":"not found"}' };
    return { ok: true, status: 200, text: async () => '{"publisherModels":[{"name":"publishers/google/models/gemini-3-pro"},{"name":"publishers/google/models/gemini-3-flash"}]}' };
  };

  const got = await assist.listModels({ provider: "vertex", location: "us-central1", project: "p" });
  assert.deepEqual(got.models, ["gemini-3-flash", "gemini-3-pro"], "name 앞의 publishers/google/models/ 를 떼어낸다");
  assert.equal(tried.length, 2);
  assert.ok(!tried[0].includes("/projects/"), "목록 주소에는 프로젝트가 안 붙는다");

  // 404 가 아니면 그 답이 곧 사실이다 — 더 물어보지 않는다
  tried.length = 0;
  global.fetch = async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    tried.push(String(url));
    return { ok: false, status: 403, text: async () => "denied" };
  };
  const denied = await assist.listModels({ provider: "vertex", location: "us-central1", project: "p" });
  assert.equal(denied.status, 403);
  assert.equal(tried.length, 1);
});

// 리전을 안 적으면 global 이고, 그때는 호스트에 리전이 안 붙는다
test("버텍스 리전 기본값은 global", async () => {
  const shown = await assist.preview({ provider: "vertex", model: "gemini-3-pro", project: "p" });
  assert.match(shown.url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/global\//);
});

// 파일로 따로 두면 그 파일이 어디 있는지 또 관리해야 한다 — 다른 키와 같은 자리에 둔다.
test("버텍스: 서비스 계정 JSON 을 그대로 붙여넣어도 된다", async () => {
  const inline = JSON.stringify({ client_email: "bot@p.iam.gserviceaccount.com", private_key: PRIVATE_KEY, project_id: "인라인-프로젝트" });
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: us-central1\n", [{ role: "user", text: "{{목록}}" }]);
  // 다른 칸은 그대로 둔다 — 뒤에 오는 테스트가 같은 파일을 본다
  fs.writeFileSync(path.join(DIR, "ai-keys.yaml"), `openai: ${KEY}\ncustom: ${KEY}\nanthropic: ${KEY}\nvertex: ${JSON.stringify(inline)}\n`);
  configData._setConfigDir(DIR);
  require("../src/googleAuth")._reset();

  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  };

  await assist.accepts(cand("A"), {});
  // 프로젝트를 안 적었으면 붙여넣은 JSON 의 project_id 를 쓴다
  assert.match(calls.at(-1).url, /\/projects\/인라인-프로젝트\//);
  assert.equal(calls.at(-1).init.headers.Authorization, "Bearer ya29.가짜");
});

// 서비스 계정 JSON 은 이 기능에서 가장 값비싼 비밀이다. 화면에도 응답에도 있으면 안 된다.
test("버텍스: 서비스 계정 키와 토큰이 밖으로 나가지 않는다", async () => {
  global.fetch = async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.진짜같은토큰","expires_in":3600}' };
    return { ok: false, status: 401, text: async () => "denied for token ya29.진짜같은토큰" };
  };
  require("../src/googleAuth")._reset();

  const shown = await assist.sendTest({ provider: "vertex", model: "gemini-3-pro", location: "us-central1", project: "p" });
  const dump = JSON.stringify(shown);
  assert.ok(!dump.includes("PRIVATE KEY"), "서비스 계정 키가 나가면 안 된다");
  assert.ok(!dump.includes(PRIVATE_KEY.slice(40, 90)));
  assert.ok(!dump.includes("ya29.진짜같은토큰"), "받아 둔 토큰도 가린다");
  assert.equal(shown.headers.Authorization, `Bearer ${assist.REDACTED}`);
});

test("인증이 실린 헤더는 어느 이름이든 가린다", async () => {
  const shown = await assist.preview({ provider: "anthropic", model: "claude-x" }, "록");
  assert.equal(shown.headers["x-api-key"], assist.REDACTED);
  assert.ok(!JSON.stringify(shown).includes(KEY));

  const openai = await assist.preview({ provider: "openai", model: "gpt" }, "록");
  assert.equal(openai.headers.Authorization, `Bearer ${assist.REDACTED}`, "붙는 방식은 보이는 편이 낫다");
});

test("클라우드 프로바이더에는 키를 붙인다", async () => {
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "{}" };
  };

  await assist.listModels({ provider: "openai", baseUrl: "https://api.openai.com/v1" });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
});

test("유료 확인은 짧은 물음 하나만 보낸다 — 판정 프롬프트가 아니다", async () => {
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"안녕하세요. 42입니다."}}]}' };
  };

  const got = await assist.ping({ provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "gemma3n:e2b" });
  assert.equal(got.ok, true);
  assert.equal(got.answer, "안녕하세요. 42입니다.");

  const sent = calls[0].body;
  assert.equal(sent.messages.length, 1, "한 마디만 보낸다");
  assert.equal(sent.messages[0].content, assist.PING_TEXT);
  assert.ok(!JSON.stringify(sent).includes("{{목록}}"), "판정 프롬프트는 안 실린다");
});

// ── 모델이 공백을 이상하게 뱉을 때 ────────────────────────────────────────

// gemma 계열이 토크나이저의 공백 표시(U+2581)를 답에 그대로 흘리면
// JSON.parse 가 `Unexpected token '▁'` 로 죽는다. 실제로 겪은 것이다.
test("답에 U+2581 이 섞여 와도 읽는다", async () => {
  useConfig(ON);
  answers(`[\n▁▁{"n": 1, "song": true, "fits": true}\n]`);
  assert.equal(await assist.accepts(cand("A"), {}), true);

  answers(`[\n▁▁{"n": 1, "song": false, "fits": true}\n]`);
  assert.equal(await assist.accepts(cand("A"), {}), false, "읽었으니 판정도 따른다");
});

// ── 줄 형식의 모르는 이름 ─────────────────────────────────────────────────

// 아는 이름인데 값이 없으면 낱말째 빼지만, 모르는 이름은 건드리지 않는다 —
// 오타를 조용히 지우면 왜 사라졌는지 알 길이 없다.
test("줄 형식의 모르는 자리표시자는 그대로 남는다", async () => {
  useConfig(`${ON}list:\n  lineFormat: "{{제목}} / {{아티스트}} / {{길이분}}분"\n`, [{ role: "user", text: "{{목록}}" }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), {});
  assert.equal(calls.at(-1).body.messages[0].content, "Toxicity / {{아티스트}} / 3분");
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
