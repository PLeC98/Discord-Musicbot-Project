// src/autoplay/assist/index.ts — 자동재생 AI 보조.
//
// 이 기능의 계약은 "맞히는 것"이 아니라 없어도 돌아가는 것이다.
// 모델이 죽든, 느리든, 헛소리를 하든 자동재생이 멈추면 안 된다. 그 경계만 못 박는다.
// (판정 품질 자체는 모델과 프롬프트의 몫이고 notes/research-autoplay-quality.md 에서 쟀다.)

import { test, after } from "node:test";
import assert from "node:assert/strict";

import * as aiConfig from "../../src/config/ai.ts";
import { useDocument, useDefaultDocuments } from "../helpers/config-docs.ts";
import * as aiKeys from "../../src/store/ai-keys.ts";
import * as secrets from "../../src/store/secrets.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import * as assist from "../../src/autoplay/assist/index.ts";
import { fake } from "../helpers/fake.ts";
import { networkError } from "../helpers/errors.ts";
import * as googleAuth from "../../src/autoplay/assist/google-auth.ts";
import * as route from "../../src/autoplay/route.ts";
import { prepare } from "../../src/autoplay/filter.ts";
import sink from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";
import { parse as parseYaml } from "yaml";
import type { PromptSection } from "../../src/config/schema/ai-prompt.ts";

// 보낸 요청. 우리 코드는 본문을 글로, 헤더를 객체로 보낸다
type SentInit = { method?: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal };
// 보낸 본문에서 시험이 읽는 칸. 규격마다 다른 이름을 한 모양에 모았다
type Message = { role: string; content: string };
type SentBody = {
  model?: string;
  messages: Message[];
  system?: string;
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: { temperature?: unknown; topP?: unknown };
  output_config: { effort?: unknown };
  thinking?: { type?: unknown };
  [key: string]: unknown;
};
// 가짜 응답은 여기서 읽는 칸(ok · status · json · text)만 준다
type FakeResponse = { ok: boolean; status?: number; headers?: Headers; json?: () => Promise<unknown>; text?: () => Promise<string> };
// 보조가 바깥으로 보내는 요청(모델 · 토큰 셈 · 서비스 계정 토큰)을 이 가짜로 받는다
function useFetch(fn: (url: string, init: SentInit) => FakeResponse | Promise<FakeResponse>) {
  assist.useFetch(fake<typeof fetch>(fn));
}

after(() => useDefaultDocuments());

// 설정을 갈아끼운다(설정 문서 "ai" 를 옛 설정 파일 꼴의 YAML 글로 적는다).
//
// 프롬프트는 딴 문서다("ai-prompt") — 설정에는 안 섞는다.
// 키는 비밀 표에 있다(store/ai-keys). 프로바이더마다 따로고, 넣을 때의 주소에 묶인다
const KEY = "sk-test-do-not-log";
const store = openTempStore("musicbot-ai-keys-");
secrets._useKey(Buffer.alloc(32, 5).toString("base64"));
after(() => {
  secrets._useKey();
  store.close();
});
// 버텍스는 키가 아니라 서비스 계정 JSON 을 쓴다 — 진짜 키라야 서명이 통과한다
import nodecrypto from "node:crypto";
const { privateKey: PRIVATE_KEY } = nodecrypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA_JSON = JSON.stringify({ client_email: "bot@p.iam.gserviceaccount.com", private_key: PRIVATE_KEY, project_id: "json-프로젝트" });

// 키를 묶을 설정. 일부러 틀리게 적은 글(겹친 칸 등)도 받는다
function settingsOf(yaml: string): Record<string, unknown> {
  try {
    return (parseYaml(yaml, { uniqueKeys: false }) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// 키를 넣는다. 묶는 주소는 그 설정이 가리키는 곳(저장된 설정 = 화면에서 키를 넣을 때의 설정)
function putKeys(settings: Record<string, unknown>) {
  for (const [provider, value] of Object.entries({ openai: KEY, custom: KEY, anthropic: KEY, aistudio: KEY, vertex: SA_JSON })) {
    aiKeys.put(provider, value, assist.keyBinding({ ...settings, provider }));
  }
}

function useConfig(yaml: string, sections: PromptSection[] = []) {
  const settings = settingsOf(yaml);
  useDocument("ai", settings);
  useDocument("ai-prompt", sections);
  putKeys(settings);
}

// 설정 문서를 쓰지 않는 호출(preview·ping·listModels)도 키를 보게 해 둔다
useConfig("provider: off\n");

const ON = `provider: custom
baseUrl: http://127.0.0.1:11434/v1
model: test-model
timeoutMs: 5000
batchSize: 10
retryDelayMs: 0
`;

// fetch 를 갈아끼운다 — 진짜로 나가면 테스트가 남의 서버에 기댄다
const calls: Array<{ url: string; init: SentInit; body?: SentBody }> = [];
// 모델에 보낸 JSON 본문. 목록 요청(GET)과 토큰 요청(폼)에는 없다
const bodyOf = (init: SentInit): SentBody | undefined => (typeof init.body === "string" ? JSON.parse(init.body) : undefined);
after(() => {
  assist.useFetch(null);
});

function answers(reply: string | (() => FakeResponse)) {
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    if (typeof reply === "function") return reply();
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  });
}

// 마지막으로 나간 요청. 안 나갔으면 실패
function lastCall() {
  const call = calls.at(-1);
  assert.ok(call, "요청이 나가지 않았다");
  return call;
}

// 마지막 요청이 모델에 보낸 본문까지. 본문이 없으면 실패
function lastSent() {
  const call = lastCall();
  assert.ok(call.body, "본문을 실은 요청이 아니다");
  return { ...call, body: call.body };
}

const cand = (title: string, durationSec = 200) => ({ title, durationSec });

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

// 스위치(enabled: false)로 끄면 고른 프로바이더 · 모델은 그대로 두고 부르지만 않는다
test("enabled: false 면 프로바이더 · 모델이 있어도 부르지 않는다", async () => {
  useConfig("enabled: false\n" + ON);
  calls.length = 0;
  answers("[]");

  const list = [cand("A"), cand("B")];
  assert.equal(await assist.filter(list, { genre: "록" }), list, "받은 목록 그대로");
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

// 비운 칸이 Number(null) = 0 이 되면 부르자마자 끊긴다
test("비워 둔 칸은 기본값을 쓴다", () => {
  useConfig(`${ON.replace("timeoutMs: 5000", "timeoutMs:")}retries:\nretryStatus:\n`);
  const one = assist.settings();
  assert.ok(one);
  assert.equal(one.timeoutMs, 60000);
  assert.equal(one.retries, 2);
  assert.deepEqual(one.retryStatus, [408, 409, 429, 500, 502, 503, 504, 529]);
});

test("재시도 칸이 범위를 벗어나면 켜지지 않는다", () => {
  for (const bad of ["retries: 99", "retries: -1", "totalTimeoutMs: 500", "retryTimeouts: yes please", "retryDelayMs: 99999999", "retryStatus: [200]", 'retryStatus: "429"']) {
    useConfig(`${ON}${bad}\n`);
    assert.equal(assist.settings(), null, bad);
  }
  useConfig(`${ON}retries: 0\ntotalTimeoutMs: 0\nretryTimeouts: true\nretryDelayMaxMs: 60000\nretryStatus: [429]\n`);
  assert.ok(assist.settings(), "범위 안이면 켜진다");
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
    assert.deepEqual(await assist.filter(list, {}), list, "목록은 그대로");
    assert.equal(await assist.accepts(list[0], {}), true, "한 곡은 살린다");
  }
});

// ── 재시도 ────────────────────────────────────────────────────────────────

const ok1 = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '[{"n":1,"song":false,"fits":true}]' } }] }) });
const status =
  (code: number, body = "", headers?: Headers) =>
  () => ({ ok: false, status: code, headers, text: async () => body });

// 차례대로 답하고 마지막 것을 되풀이한다. 부른 수를 센다
function replies(...list: Array<() => FakeResponse>) {
  let n = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return list[Math.min(n++, list.length - 1)]();
  });
  calls.length = 0;
}

test("일시 오류는 retries 만큼 다시 부르고, 되면 그 판정을 쓴다", async () => {
  useConfig(ON);
  replies(status(503), status(500), ok1);
  assert.equal(await assist.accepts(cand("믹스"), {}), false, "세 번째 답(아니다)을 쓴다");
  assert.equal(calls.length, 3);

  replies(status(503));
  assert.equal(await assist.accepts(cand("A"), {}), true, "끝내 실패하면 규칙만으로");
  assert.equal(calls.length, 3, "기본 retries 2: 처음 한 번 + 두 번");

  useConfig(`${ON}retries: 0\n`);
  replies(status(503));
  await assist.accepts(cand("A"), {});
  assert.equal(calls.length, 1, "0 이면 다시 부르지 않는다");
});

test("고르기 안에서 한 번 끝내 실패하면 그 고르기의 다음 판정은 한 번만 부른다", async () => {
  useConfig(ON);
  const pick = { failed: false };
  replies(status(503));
  await assist.accepts(cand("A"), { pick });
  assert.equal(calls.length, 3);
  assert.equal(pick.failed, true);

  replies(status(503));
  assert.deepEqual(await assist.filter([cand("B"), cand("C")], { pick }), [cand("B"), cand("C")]);
  assert.equal(calls.length, 1, "다시 부르지 않는다");

  replies(status(503), ok1);
  assert.equal(await assist.accepts(cand("D"), { pick: { failed: false } }), false, "새 고르기는 다시 부른다");
});

// 켜 둔 기능이 한도 · 서버 오류로 죽어 있으면 평소 로그 수준에서 보여야 한다. 재시도 하나하나는 debug
test("재시도까지 모두 실패한 판정마다 warn 한 줄, 성공하면 아무것도", async () => {
  useConfig(ON);
  const from = sink.buffer.length;
  const overloaded = '{"error":{"code":503,"status":"UNAVAILABLE","message":"The model is overloaded."}}';

  replies(status(503, overloaded));
  await assist.accepts(cand("A"), {});
  await assist.accepts(cand("B"), {});
  replies(status(401, '{"error":{"message":"bad key"}}'));
  await assist.accepts(cand("C"), {});
  replies(status(503, overloaded), ok1);
  await assist.accepts(cand("D"), {});

  const lines = sink.buffer.slice(from).filter((e) => e.text.startsWith("AI 보조") && e.level !== "debug");
  assert.deepEqual(
    lines.map((e) => [e.level, e.text]),
    [
      ["warn", "AI 보조 실패(3번 불러 모두 실패): HTTP 503 UNAVAILABLE (The model is overloaded.). 이번 판정은 규칙만으로 고릅니다"],
      ["warn", "AI 보조 실패(3번 불러 모두 실패): HTTP 503 UNAVAILABLE (The model is overloaded.). 이번 판정은 규칙만으로 고릅니다"],
      ["warn", "AI 보조 실패: HTTP 401 (bad key). 이번 판정은 규칙만으로 고릅니다"],
    ],
    "다시 불러 된 판정(D)은 남기지 않는다",
  );
});

test("다시 해도 같은 답인 것은 다시 부르지 않는다", async () => {
  useConfig(ON);
  for (const [reply, why] of [
    [status(429, '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'), "OpenAI 크레딧 소진"],
    [status(429, '{"type":"error","error":{"type":"rate_limit_error","message":"enforced_spend_limit_reached"}}'), "앤트로픽 지출 상한"],
    [status(401, "bad key"), "401"],
    [status(400, "bad request"), "400"],
    [
      () => {
        throw new Error("알 수 없는 실패");
      },
      "네트워크가 아닌 예외",
    ],
  ] as const) {
    replies(reply);
    assert.equal(await assist.accepts(cand("A"), {}), true);
    assert.equal(calls.length, 1, why);
  }

  replies(status(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'));
  await assist.accepts(cand("A"), {});
  assert.equal(calls.length, 3, "버텍스 429 는 일시 경합이라 다시 부른다");

  replies(() => {
    throw networkError();
  });
  await assist.accepts(cand("A"), {});
  assert.equal(calls.length, 3, "연결 실패는 다시 부른다");
});

test("다시 부를 상태 코드는 설정으로 정한다", async () => {
  useConfig(`${ON}retryStatus: [418]\n`);
  replies(status(503));
  await assist.accepts(cand("A"), {});
  assert.equal(calls.length, 1, "목록에 없는 503");

  replies(status(418), ok1);
  assert.equal(await assist.accepts(cand("A"), {}), false);
  assert.equal(calls.length, 2);
});

// 저쪽이 멈출 때까지 붙들고 있는 부르기. 끊기면(시간 초과) 예외
function hangs() {
  useFetch(async (url, init) => {
    calls.push({ url, init });
    return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
  });
  calls.length = 0;
}

test("시간 초과는 기본으로 다시 부르지 않고, retryTimeouts 를 켜면 다시 부른다", async () => {
  useConfig(ON.replace("timeoutMs: 5000", "timeoutMs: 1000"));
  hangs();
  assert.equal(await assist.accepts(cand("A"), {}), true);
  assert.equal(calls.length, 1);

  useConfig(`${ON.replace("timeoutMs: 5000", "timeoutMs: 1000")}retryTimeouts: true\nretries: 1\n`);
  hangs();
  await assist.accepts(cand("A"), {});
  assert.equal(calls.length, 2);
});

test("판정 하나의 상한(totalTimeoutMs)을 넘기면 재시도 중이어도 그만둔다", async () => {
  // 부르기 한 번은 5초까지 기다리지만 판정 전체는 1초
  useConfig(`${ON}totalTimeoutMs: 1000\nretryTimeouts: true\n`);
  hangs();
  const started = Date.now();
  const level = logger.level;
  logger.level = "debug";
  const from = sink.buffer.length;
  try {
    assert.equal(await assist.accepts(cand("A"), {}), true);
  } finally {
    logger.level = level;
  }
  assert.ok(Date.now() - started < 3000, "상한에서 끊는다");
  assert.equal(calls.length, 1, "상한으로 끊긴 것은 다시 부르지 않는다");
  assert.ok(
    sink.buffer.slice(from).some((e) => e.text.includes("판정 상한 초과")),
    "부르기 한 번의 시간 초과와 가려 적는다",
  );

  // 대기가 남은 시간을 넘으면 기다리지 않고 그만둔다
  useConfig(`${ON.replace("retryDelayMs: 0", "retryDelayMs: 8000")}totalTimeoutMs: 2000\n`);
  replies(status(503));
  const again = Date.now();
  await assist.accepts(cand("A"), {});
  assert.ok(Date.now() - again < 1000, "대기에 들어가지 않는다");
  assert.equal(calls.length, 1);
});

test("저쪽이 기다리라는 시간을 쓰고, 대기 상한보다 길면 다시 부르지 않는다", async () => {
  useConfig(ON);
  // 제미니 API 는 헤더 없이 본문에 적는다
  const gemini = '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"34s"}]}}';
  const level = logger.level;
  logger.level = "debug";
  const from = sink.buffer.length;
  try {
    replies(status(429, gemini));
    await assist.accepts(cand("A"), {});
    assert.equal(calls.length, 1, "34초는 기본 상한 16초를 넘는다");
    assert.ok(sink.buffer.slice(from).some((e) => e.text.includes("서버가 34초 뒤라고 함")));
  } finally {
    logger.level = level;
  }

  replies(status(429, "", new Headers({ "retry-after": "0" })), ok1);
  assert.equal(await assist.accepts(cand("A"), {}), false);
  assert.equal(calls.length, 2, "Retry-After 0 이면 곧바로 다시");
});

test("판정을 읽지 못한 답은 재시도와 따로 한 번만 다시 묻는다", async () => {
  useConfig(`${ON}retries: 0\n`);
  const babble = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "죄송합니다, 판단할 수 없습니다." } }] }) });
  replies(babble, ok1);
  assert.equal(await assist.accepts(cand("A"), {}), false, "다시 물은 답을 쓴다");
  assert.equal(calls.length, 2);

  replies(babble);
  assert.equal(await assist.accepts(cand("A"), {}), true);
  assert.equal(calls.length, 2, "한 번만 더");

  // 200 인데 JSON 이 아닌 본문도 못 읽은 답이다
  const html = () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  });
  replies(html, ok1);
  assert.equal(await assist.accepts(cand("A"), {}), false);
  assert.equal(calls.length, 2);
});

// 어떤 서비스는 거절 응답에 보낸 헤더를 되비춘다. 그 본문을 오류에 실으면 로그에 키가 남는다.
test("오류 어디에도 키가 나오지 않는다", async () => {
  useConfig(ON);
  answers(() => ({ ok: false, status: 401, text: async () => `Invalid key: ${KEY}` }));

  // 로그 싱크에 받는 곳을 달아 모든 레코드를 본다. debug 까지 남게 잠시 올린다
  const seen: string[] = [];
  let watching = true;
  sink.addDestination((rec) => watching && seen.push(JSON.stringify(rec)));
  const level = logger.level;
  logger.level = "debug";
  try {
    await assist.accepts(cand("A"), {});
  } finally {
    logger.level = level;
    watching = false;
  }

  assert.ok(seen.length, "무슨 일이 있었는지는 남겨야 한다");
  for (const line of seen) assert.ok(!line.includes(KEY), `로그에 키가 남았다: ${line}`);
});

// ── 요청 모양 ────────────────────────────────────────────────────────────

test("설정한 것이 그대로 요청에 실린다", async () => {
  useConfig(`${ON}extra: |\n  think=false\n  reasoning_effort=low\n  temperature=0.4\n`, [
    { role: "system", text: "내가 쓴 기준" },
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), { genre: "록" });
  const sent = lastSent();
  assert.equal(sent.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(sent.body.model, "test-model");
  assert.equal(sent.body.think, false, "서비스마다 다른 값은 extra 로 그대로 얹는다");
  assert.equal(sent.body.temperature, 0.4, "프로필이 없는 프로바이더는 extra 로 적는다");
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
  const sent = lastSent().body.messages;
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
    { role: "user", text: "아래를 판정해라\n{{list}}" },
  ]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  const sent = lastSent().body.messages;
  assert.deepEqual(
    sent.map((one) => one.role),
    ["system", "assistant", "user"],
  );
  assert.equal(sent[0].content, "기준이다");
  assert.match(sent[2].content, /^아래를 판정해라\n1\. 장르=록 길이=3분 제목=Toxicity/);
});

test("{{list}} 자리에 후보가 들어간다 — 어느 역할이든", async () => {
  useConfig(ON, [{ role: "system", text: "기준. 목록: {{list}} 끝." }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true},{"n":2,"song":true,"fits":true}]');

  await assist.filter([cand("A", 60), cand("B", 120)], { genre: "록" });
  const sent = lastSent().body.messages;
  assert.equal(sent.length, 1, "섹션이 하나면 메시지도 하나다");
  assert.equal(sent[0].content, "기준. 목록: 1. 장르=록 길이=1분 제목=A\n2. 장르=록 길이=2분 제목=B 끝.");
});

test("내용이 빈 섹션은 보내지 않는다", async () => {
  useConfig(ON, [
    { role: "system", text: "기준이다" },
    { role: "assistant", text: "   " },
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.messages.length, 2);
});

// ── 후보 목록의 모양 ──────────────────────────────────────────────────────

test("줄 형식을 직접 짤 수 있다", async () => {
  useConfig(`${ON}list:\n  lineFormat: "{{index}}) {{title}} [{{duration::s}}s]"\n`, [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  assert.equal(lastSent().body.messages[0].content, "1) Toxicity [210s]");
});

// 길이를 모르는데 "0분"이라고 적으면 모델에게 거짓을 알려 주는 것이다. 어떻게 적을지는 줄 형식 안에서 정한다({{#if-exist}} · {{:else}})
test("길이를 모르는 후보 — 구간째 빼거나, 글자로 적거나, 0으로", async () => {
  const unknown = { title: "이름만 아는 곡" };
  const ask = async (yaml: string) => {
    useConfig(`${ON}${yaml}`, [{ role: "user", text: "{{list}}" }]);
    calls.length = 0;
    answers('[{"n":1,"song":true,"fits":true}]');
    await assist.accepts(unknown, { genre: "록" });
    return lastSent().body.messages[0].content;
  };

  assert.equal(await ask(""), "1. 장르=록 제목=이름만 아는 곡", "기본은 길이 구간을 통째로 뺀다");
  const withElse = (otherwise: string) => `list:\n  lineFormat: "{{index}}. 장르={{genre}} 길이={{#if-exist {{duration}}}}{{duration::m}}분{{:else}}${otherwise}{{/}} 제목={{title}}"\n`;
  assert.equal(await ask(withElse("모름")), "1. 장르=록 길이=모름 제목=이름만 아는 곡");
  assert.equal(await ask(withElse("0분")), "1. 장르=록 길이=0분 제목=이름만 아는 곡");

  // 아는 후보는 어느 설정에서도 그대로다
  useConfig(ON);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');
  await assist.accepts(cand("Toxicity", 210), { genre: "록" });
  assert.equal(lastSent().body.messages[1].content, "1. 장르=록 길이=3분 제목=Toxicity");
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

// 점 표기가 없으면 추론 레벨을 여기로 우회할 수 없다. 키 이름이 통째로 들어가 조용히 무시됐다.
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
  const sent = lastSent();
  assert.equal(sent.init.headers.Authorization, undefined, "지우라고 한 헤더는 안 나간다");
  assert.equal(sent.init.headers["X-Title"], "지움 확인", "나머지 헤더는 그대로");
});

test("헤더와 {{none}} 이 실제 요청에 반영된다", async () => {
  useConfig(`${ON}extra: |\n  header::X-Title=Musicbot\n  temperature={{none}}\n  top_p=0.5\n`);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.equal(sent.init.headers["X-Title"], "Musicbot");
  assert.ok(!("temperature" in sent.body), "{{none}} 은 아예 안 보낸다");
  assert.equal(sent.body.top_p, 0.5);
});

// ── 모델 프로필이 정한 칸 ────────────────────────────────────────────────

// 값이 본문 어디로 가는지는 모델 프로필이 안다(data/ai-models.json).
test("params 는 프로필이 적어 둔 경로로 간다", async () => {
  useConfig("provider: anthropic\nmodel: claude-opus-5\nparams:\n  claude-opus-5:\n    effort: high\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ content: [{ text: "[]" }] }) };
  });

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.equal(sent.body.output_config.effort, "high");
  assert.equal(sent.body.thinking?.type, "adaptive", "안 고른 칸은 프로필 기본값으로");
});

// 모델을 바꾸면 그 모델이 안 받는 값은 저절로 빠져야 한다 — 그대로 보내면 400 이다.
test("그 모델이 안 받는 값은 안 보낸다", async () => {
  // Astra 는 reasoning_effort 에 none 을 안 받는다(프로필 enum 에 없다)
  useConfig("provider: openai\nmodel: gpt-6-astra\nparams:\n  gpt-6-astra:\n    reasoning_effort: none\n    없는칸: 1\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.equal(sent.body.reasoning_effort, undefined, "enum 에 없는 값은 버린다");
  assert.equal(sent.body["없는칸"], undefined, "프로필이 모르는 칸도 버린다");
});

// 장르는 한 요청에 하나다 — 모든 줄이 같은 값을 쓰므로 프롬프트에서도 쓸 수 있다.
test("{{genre}} 는 프롬프트에서도 풀린다", async () => {
  useConfig(`${ON}`, [
    { role: "system", text: "너는 {{genre}} 판정기다" },
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), { genre: "재즈" });
  assert.equal(lastSent().body.messages[0].content, "너는 재즈 판정기다");
});

// 저쪽이 배열을 바라는 칸에 글자를 보내면 400 이다. 설정 파일을 손으로 고쳤을 수 있다.
test("종류가 안 맞는 값은 안 보낸다", async () => {
  useConfig("provider: openai\nmodel: gpt-6-astra\nparams:\n  gpt-6-astra:\n    stop: 그냥글자\n    seed: 열둘\n    logprobs: 켬\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.equal(sent.body.stop, undefined, "배열 칸에 글자는 안 보낸다");
  assert.equal(sent.body.seed, undefined, "숫자 칸에 글자는 안 보낸다");
  assert.equal(sent.body.logprobs, false, "종류가 틀리면 프로필 기본값으로 떨어진다");
});

// 배열·JSON 칸도 제 모양이면 그대로 실린다.
test("배열과 JSON 칸은 제 모양이면 실린다", async () => {
  useConfig("provider: openai\nmodel: gpt-6-astra\nparams:\n  gpt-6-astra:\n    stop:\n      - 끝\n      - 그만\n    metadata:\n      who: musicbot\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.deepEqual(sent.body.stop, ["끝", "그만"]);
  assert.deepEqual(sent.body.metadata, { who: "musicbot" });
});

// 화면에 안 보이는(고급) 칸이라도 프로필 기본값은 붙어야 한다.
test("프로필 기본값은 고르지 않아도 붙는다", async () => {
  useConfig("provider: openai\nmodel: gpt-6-astra\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
  assert.equal(sent.body.max_completion_tokens, 8192);
  assert.equal(sent.body.parallel_tool_calls, true);
  assert.equal(sent.body.logprobs, false);
});

// 켰다 끈 값이 params 에 남는다. 그대로 보내면 저쪽이 거절한다 —
// top_logprobs 는 logprobs 가 꺼져 있으면 400 이다.
test("조건이 안 맞는 칸은 보내지 않는다", async () => {
  const withLogprobs = (on: string) => "provider: openai\nmodel: gpt-5.5\nparams:\n  gpt-5.5:\n    logprobs: " + on + "\n    top_logprobs: 5\n";

  useConfig(withLogprobs("true"), [{ role: "user", text: "{{list}}" }]);
  answers("[]");
  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.top_logprobs, 5, "켜 두었으면 나간다");

  useConfig(withLogprobs("false"), [{ role: "user", text: "{{list}}" }]);
  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.logprobs, false);
  assert.ok(!("top_logprobs" in lastSent().body), "끄면 딸린 칸도 안 나간다");
});

// 온도도 모델이 받는 칸 하나다 — 프로필이 적어 둔 자리로 들어간다(제미니는 generationConfig 안).
// 끝 슬래시를 떼는 정규식이 역추적으로 O(n²) 였다 — 20만 글자에 12.4초 동안 이벤트 루프가 멈췄다.
test("긴 주소에도 끝 슬래시 떼기가 느려지지 않는다", () => {
  const one = { provider: "custom", baseUrl: "/".repeat(200_000) + "x" };
  const started = Date.now();
  assist.endpointOf(one);
  assert.ok(Date.now() - started < 500, "선형이어야 한다");

  assert.equal(assist.endpointOf({ provider: "custom", baseUrl: "http://x/v1///" }), "http://x/v1", "하던 일은 그대로");
  assert.equal(assist.endpointOf({ provider: "custom", baseUrl: "" }), "");
});

// 점 경로는 설정 글에서만 오는 것이 아니다 — 모델 레지스트리의 mapsTo.path 로도 온다.
// 레지스트리는 우리가 내려받는 남의 데이터라, `__proto__` 한 마디로 프로세스 전체가 오염될 수 있었다.
test("점 경로로 Object.prototype 을 오염시킬 수 없다", () => {
  for (const name of ["__proto__.뚫림", "constructor.prototype.뚫림", "a.__proto__.뚫림"]) {
    const got = assist.parseExtra(`${name}=1`);
    assert.deepEqual(got.body, {}, name);
    assert.match(got.problems.join(" "), /쓸 수 없는 이름/, `${name} — 조용히 버리지 않고 알려 준다`);
  }
  assert.equal(({} as { 뚫림?: unknown }).뚫림, undefined, "Object.prototype 이 멀쩡해야 한다");
});

// 멀쩡한 점 경로는 그대로 통해야 한다 — 위 가드가 과하게 막으면 안 된다
test("평범한 점 경로는 막지 않는다", () => {
  const got = assist.parseExtra("generationConfig.topP=0.9");
  assert.deepEqual(got.body, { generationConfig: { topP: 0.9 } });
  assert.deepEqual(got.problems, []);
});

test("온도는 params 를 타고 프로필이 적은 자리로 간다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3.7-flash\nlocation: global\nparams:\n  gemini-3.7-flash:\n    temperature: 0.7\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  });

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.generationConfig.temperature, 0.7);

  // 안 적으면 아예 안 보낸다 — 저쪽이 안 받는 모델도 있다
  useConfig("provider: vertex\nmodel: gemini-3.7-flash\nlocation: global\n", [{ role: "user", text: "{{list}}" }]);
  await assist.accepts(cand("A"), {});
  assert.ok(!("temperature" in (lastSent().body.generationConfig || {})));
});

// 모델을 바꾸면 앞 모델에서 고른 값이 따라오면 안 된다.
test("params 는 모델마다 따로 기억한다", async () => {
  useConfig("provider: openai\nmodel: gpt-5.5\nparams:\n  gpt-6-astra:\n    reasoning_effort: max\n  gpt-5.5:\n    reasoning_effort: none\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers("[]");

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.reasoning_effort, "none", "고른 모델 것만 쓴다");
});

// 앤트로픽은 max_tokens 가 필수다 — 프로필의 defaults 가 채운다.
test("프로필의 기본값은 늘 붙는다", async () => {
  useConfig("provider: anthropic\nmodel: claude-opus-5\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ content: [{ text: "[]" }] }) };
  });

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.max_tokens, 4096);
});

// 추가 파라미터는 프로필이 모르는 것을 넣는 비상구다 — 마지막 말을 갖는다.
test("추가 파라미터가 params 를 이긴다", async () => {
  useConfig("provider: anthropic\nmodel: claude-opus-5\nparams:\n  claude-opus-5:\n    effort: low\nextra: output_config.effort=max\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ content: [{ text: "[]" }] }) };
  });

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.output_config.effort, "max");
});

// ── 프롬프트 ─────────────────────────────────────────────────

test("프롬프트가 비어 있으면 기본 구성으로 돈다", async () => {
  useConfig(ON); // 프롬프트를 안 적는다
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.messages[0].content, assist.DEFAULT_PROMPT);
});

// ── 미리보기 ─────────────────────────────────────────────────────────────

const DRAFT = { provider: "custom", baseUrl: "http://127.0.0.1:11434/v1/", model: "test-model", extra: "think=false" };

// 미리보기는 아무 데도 안 나간다. 테스트만 실제로 보낸다 — 둘을 섞으면
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
  const asked = (shown.body as SentBody).messages.at(-1)?.content;
  assert.ok(asked, "목록 섹션이 있어야 한다");
  assert.equal(asked.split("\n").length, 3);
  assert.match(asked, /^3\. 장르=록 제목=/m, "길이를 모르는 줄은 그 칸이 빠진다");
});

test("테스트는 실제로 보내고 나간 것·온 것을 그대로 준다", async () => {
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"[]"}}]}' };
  });

  const shown = await assist.judgeTest(DRAFT, [], "록");
  assert.equal(calls.length, 1, "한 번 나간다");
  assert.equal(shown.status, 200);
  assert.match(shown.response, /choices/, "응답은 손대지 않고 그대로 준다");
  assert.equal(shown.headers.Authorization, "Bearer [REDACTED_SECRET_KEY]");
});

test("테스트는 못 보내도 던지지 않는다", async () => {
  useFetch(async () => {
    throw new Error("연결 실패");
  });
  const shown = await assist.judgeTest({ provider: "openai", baseUrl: "http://x/v1", model: "m" }, []);
  assert.equal(shown.status, null);
  assert.match(shown.response, /연결 실패/);
});

// 거절 응답에 보낸 값을 되비추는 서비스가 있다 — 화면에도 로그에도 키가 남으면 안 된다
test("응답에 키가 섞여 와도 가려서 준다", async () => {
  useFetch(async () => ({ ok: false, status: 401, text: async () => `bad key: ${KEY}` }));

  const shown = await assist.judgeTest({ provider: "openai", baseUrl: "http://x/v1", model: "m" }, []);
  assert.equal(shown.status, 401);
  assert.ok(!shown.response.includes(KEY), shown.response);
  // 별표만 있으면 원래 그런 값인 줄 안다 — 무엇이 가려졌는지 이름을 붙인다
  assert.ok(shown.response.includes(assist.REDACTED), shown.response);
});

// ── 오류를 그대로 보여준다 ────────────────────────────────────────────────

// 왜 거절됐는지는 본문에만 있다(모델 이름 오타 · 사용량 초과 …). 상태 코드만으론 못 고친다.
test("확인 실패는 상태 코드와 본문을 그대로 전한다", async () => {
  useFetch(async () => ({ ok: false, status: 429, text: async () => '{"error":"rate limit exceeded"}' }));

  const got = await assist.listModels({ provider: "openai", baseUrl: "http://x/v1" });
  assert.equal(got.ok, false);
  assert.match(String(got.reason), /429/);
  assert.match(String(got.response), /rate limit exceeded/);

  assert.match(String((await assist.listModels({ provider: "off" })).reason), /provider=off/, "왜 안 도는지도 그대로 말한다");
});

// ── 무료 확인(모델 목록)과 유료 확인(짧은 생성) ───────────────────────────

// 연결만 보고 싶은데 판정 프롬프트를 통째로 보내면 토큰도 들고,
// "연결이 안 되는 것"과 "판정을 못 읽은 것"이 섞인다.
test("무료 확인은 모델 목록만 받는다 — 추론이 없다", async () => {
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => '{"data":[{"id":"gemma3n:e2b"},{"id":"qwen3:8b"}]}' };
  });

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

test("custom 은 저장된 주소와 같을 때만 키를 붙인다", async () => {
  useConfig("provider: custom\nbaseUrl: https://내가저장한곳/v1\nmodel: m\n");
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => "{}" };
  });

  await assist.ping({ provider: "custom", baseUrl: "https://공격자/v1", model: "m" });
  assert.ok(!lastCall().init.headers.Authorization, "저장 안 한 주소에는 키를 안 붙인다");

  await assist.ping({ provider: "custom", baseUrl: "https://내가저장한곳/v1", model: "m" });
  assert.equal(lastCall().init.headers.Authorization, `Bearer ${KEY}`, "저장된 주소면 붙인다");

  // 주소가 박힌 프로바이더는 애초에 초안이 주소를 못 바꾼다
  await assist.ping({ provider: "openai", baseUrl: "https://공격자/v1", model: "m" });
  assert.equal(lastCall().url, "https://api.openai.com/v1/chat/completions");
});

// 저장된 주소를 바꿔도 키는 넣을 때의 주소에 묶여 있어 새 주소로 가지 않는다. 다시 넣어야 한다
test("키는 넣을 때의 주소에 묶인다: 주소를 바꿔 저장해도 새 주소에는 키를 안 붙인다", async () => {
  useConfig("provider: custom\nbaseUrl: https://내가저장한곳/v1\nmodel: m\n");
  // 키는 그대로 두고 주소만 바꿔 저장한다
  useDocument("ai", { provider: "custom", baseUrl: "https://바뀐곳/v1", model: "m" });
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => "{}" };
  });
  await assist.ping({ provider: "custom", baseUrl: "https://바뀐곳/v1", model: "m" });
  assert.ok(!lastCall().init.headers.Authorization, "저장된 주소여도 키가 묶인 곳이 아니면 안 붙인다");
  assert.equal(aiKeys.stateOf("custom", assist.keyBinding({ provider: "custom", baseUrl: "https://바뀐곳/v1" })), "moved");

  // 버텍스는 리전으로 만든 호스트에 묶인다
  assert.equal(assist.keyBinding({ provider: "vertex", location: "us-central1" }), "https://us-central1-aiplatform.googleapis.com");
  assert.equal(assist.keyBinding({ provider: "vertex" }), "https://aiplatform.googleapis.com");
  useConfig(ON);
});

test("추가 인자에 비밀 헤더는 적지 못한다(평문 설정 · 내보내기에 남는다). 빼는 줄은 된다", () => {
  const of = (extra: string) => aiConfig.validateAi({ provider: "openai", extra }).filter((one) => one.includes("extra"));
  assert.equal(of("header::Authorization=Bearer sk-몰래").length, 1);
  assert.equal(of("top_p=0.5\nheader::X-Api-Key=abc").length, 1, "대소문자를 가리지 않는다");
  assert.equal(of("header::Cookie=SID=1").length, 1);
  assert.deepEqual(of("header::Authorization={{none}}\nheader::X-Title=bot"), []);
});

// 모델 이름은 코드에 안 적는다. 대신 안 쓸 것을 설정에서 가린다 —
// 저쪽 목록에는 영상·이미지 모델이나 한참 옛 모델이 섞여 나온다.
// 키가 없으면 저쪽은 401 뿐이다. 묻지 않고 받아 둔 모델 프로필(data/ai-models.json)로 목록을 채운다. 연결 확인은 실패로 둔다
test("모델 목록: 키가 없거나 저쪽이 거절하면 받아 둔 목록으로 채운다(확인 결과는 실패 그대로)", async () => {
  const preset = (await import("../../src/config/ai-models.ts")).modelsOf("openai").map((one) => one.modelId);
  assert.ok(preset.length > 0, "받아 둔 프로필에 openai 모델이 있다");

  calls.length = 0;
  useFetch(async (url, init) => (calls.push({ url, init }), { ok: false, status: 401, text: async () => "no" }));
  aiKeys.remove("openai");
  const keyless = await assist.listModels({ provider: "openai", hideModels: [preset[0]] });
  assert.deepEqual(calls, [], "키 없이는 묻지 않는다");
  assert.deepEqual([keyless.ok, keyless.preset, keyless.models?.length, keyless.hiddenCount], [false, true, preset.length - 1, 1]);
  assert.match(String(keyless.reason), /키가 없어/);

  useConfig(ON); // 키를 다시 넣는다
  const refused = await assist.listModels({ provider: "openai" });
  assert.equal(calls.length, 1, "키가 있으면 묻는다");
  assert.deepEqual([refused.ok, refused.status, refused.preset, refused.models?.length], [false, 401, true, preset.length]);

  // 프로필이 없는 곳(custom)은 채울 것이 없다
  aiKeys.remove("custom");
  assert.equal((await assist.listModels({ provider: "custom", baseUrl: "http://127.0.0.1:11434/v1" })).models, undefined);
  useConfig(ON);
});

test("모델 목록에서 가릴 것을 설정으로 정한다", async () => {
  useFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: [{ id: "gpt-5" }, { id: "sora-2" }, { id: "gpt-3.5-turbo" }, { id: "nano-banana-pro-preview" }, { id: "text-embedding-3-small" }] }),
  }));

  const got = await assist.listModels({ provider: "openai", hideModels: ["*sora*", "gpt-3.5*", "*banana*", "*embedding*"] });
  assert.deepEqual(got.models, ["gpt-5"]);
  assert.equal(got.hiddenCount, 4, "몇 개를 가렸는지 알려 준다 — 조용히 사라지면 안 된다");

  // 안 적으면 그대로 다 온다
  assert.equal((await assist.listModels({ provider: "openai" })).models?.length, 5);

  // 글롭이지 정규식이 아니다 — 점은 점이다
  const dots = await assist.listModels({ provider: "openai", hideModels: ["gpt.5"] });
  assert.ok(dots.models?.includes("gpt-5"), "gpt.5 가 gpt-5 를 가리면 안 된다");
});

// ── 앤트로픽 네이티브 ─────────────────────────────────────────────────────

// OpenAI 와 다른 것 셋: system 이 본문 맨 위 칸, max_tokens 가 필수, 인증이 x-api-key.
test("앤트로픽은 네이티브 규격으로 보낸다", async () => {
  useConfig("provider: anthropic\nmodel: claude-x\n", [
    { role: "system", text: "기준 하나" },
    { role: "system", text: "기준 둘" },
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ content: [{ type: "text", text: '[{"n":1,"song":true,"fits":true}]' }] }) };
  });

  assert.equal(await assist.accepts(cand("A"), { genre: "록" }), true, "content[].text 에서 판정을 읽는다");

  const sent = lastSent();
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.init.headers["x-api-key"], KEY, "Authorization 이 아니라 x-api-key 다");
  assert.ok(!sent.init.headers.Authorization);
  assert.equal(sent.init.headers["anthropic-version"], "2023-06-01");

  assert.equal(sent.body.system, "기준 하나\n\n기준 둘", "system 은 본문 맨 위 칸으로 올리고 여럿이면 붙인다");
  assert.ok(Number(sent.body.max_tokens) > 0, "없으면 400 이다");
  assert.deepEqual(
    sent.body.messages.map((m) => m.role),
    ["user"],
    "system 은 messages 에 남지 않는다",
  );
});

test("앤트로픽 모델 목록과 max_tokens 덮어쓰기", async () => {
  useConfig("provider: anthropic\nmodel: claude-x\nextra: max_tokens=4096\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => '{"data":[{"id":"claude-opus-5"},{"id":"claude-sonnet-5"}]}', json: async () => ({ content: [{ text: "[]" }] }) };
  });

  const got = await assist.listModels({ provider: "anthropic" });
  assert.deepEqual(got.models, ["claude-opus-5", "claude-sonnet-5"]);
  assert.equal(lastCall().url, "https://api.anthropic.com/v1/models");

  await assist.accepts(cand("A"), {});
  assert.equal(lastSent().body.max_tokens, 4096, "모자라면 extra 로 늘린다");
});

// ── 버텍스 AI(제미니 네이티브) ────────────────────────────────────────────

// 여기만 유난히 다르다: 주소를 조립하고, 토큰으로 인증하고, 본문이 contents/parts 다.
test("버텍스는 주소를 조립하고 제미니 본문으로 보낸다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: us-central1\n", [
    { role: "system", text: "기준이다" },
    { role: "user", text: "{{list}}" },
  ]);
  googleAuth._reset();

  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"n":1,"song":true,"fits":true}]' }] } }] }) };
  });

  assert.equal(await assist.accepts(cand("A"), { genre: "록" }), true, "candidates[].content.parts[].text 를 읽는다");

  const token = calls.find((one) => String(one.url).includes("oauth2"));
  assert.ok(token, "먼저 서비스 계정으로 토큰을 받는다");

  const sent = lastSent();
  // 주소 칸은 인코딩해 조립한다(rules/vertex-url). 비교는 풀어서
  assert.equal(decodeURI(String(sent.url)), "https://us-central1-aiplatform.googleapis.com/v1/projects/json-프로젝트/locations/us-central1/publishers/google/models/gemini-3-pro:generateContent");
  assert.equal(sent.init.headers.Authorization, "Bearer ya29.가짜");
  assert.deepEqual(sent.body.systemInstruction, { parts: [{ text: "기준이다" }] }, "system 은 딴 칸이다");
  assert.equal(sent.body.contents[0].role, "user");
  assert.ok(sent.body.contents[0].parts[0].text.includes("장르=록"));
  assert.ok(!("messages" in sent.body));
});

// 경로는 언제나 본문 맨 위부터다. 버텍스라고 generationConfig 안으로 넣어 주지 않는다 —
// 모델 프로필의 mapsTo.path 와 같은 규칙이라야 두 길이 어긋나지 않는다.
test("버텍스: assistant 는 model 이고, 추가 파라미터는 적은 경로 그대로 간다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: global\nextra: generationConfig.topP=0.9\n", [
    { role: "assistant", text: "알겠다" },
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  });

  await assist.accepts(cand("A"), {});
  const sent = lastSent();
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
    { role: "user", text: "{{list}}" },
  ]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  });

  await assist.accepts(cand("A"), {});
  const sent = lastSent();

  assert.match(sent.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.7-flash:generateContent$/);
  assert.equal(sent.init.headers["x-goog-api-key"], KEY, "키는 x-goog-api-key 로 간다");
  assert.equal(sent.init.headers.Authorization, undefined, "Bearer 가 아니다");
  assert.ok(sent.body.contents, "messages 가 아니라 contents 다");
  assert.equal(sent.body.systemInstruction.parts[0].text, "너는 판정기다");
  assert.equal(sent.body.generationConfig.topP, 0.5, "추가 파라미터도 적은 경로 그대로");
});

// 모델 목록은 생성과 주소 체계가 다르다(프로젝트·리전이 안 붙는다).
// 생성 주소를 그대로 썼다가 404 를 봤다. API 버전이 갈려 있어 차례로 물어본다.
test("버텍스 모델 목록: 404 면 다음 주소로 넘어간다", async () => {
  const tried: string[] = [];
  useFetch(async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    tried.push(String(url));
    if (tried.length < 2) return { ok: false, status: 404, text: async () => '{"error":"not found"}' };
    return { ok: true, status: 200, text: async () => '{"publisherModels":[{"name":"publishers/google/models/gemini-3-pro"},{"name":"publishers/google/models/gemini-3-flash"}]}' };
  });

  // 키는 리전으로 만든 호스트에 묶인다. 이 리전으로 넣어 둔다
  aiKeys.put("vertex", SA_JSON, assist.keyBinding({ provider: "vertex", location: "us-central1" }));
  const got = await assist.listModels({ provider: "vertex", location: "us-central1", project: "p" });
  assert.deepEqual(got.models, ["gemini-3-flash", "gemini-3-pro"], "name 앞의 publishers/google/models/ 를 떼어낸다");
  assert.equal(tried.length, 2);
  assert.ok(!tried[0].includes("/projects/"), "목록 주소에는 프로젝트가 안 붙는다");

  // 404 가 아니면 그 답이 곧 사실이다 — 더 물어보지 않는다
  tried.length = 0;
  useFetch(async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    tried.push(String(url));
    return { ok: false, status: 403, text: async () => "denied" };
  });
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
  useConfig("provider: vertex\nmodel: gemini-3-pro\nlocation: us-central1\n", [{ role: "user", text: "{{list}}" }]);
  aiKeys.put("vertex", inline, assist.keyBinding({ provider: "vertex", location: "us-central1" }));
  googleAuth._reset();

  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.가짜","expires_in":3600}' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }) };
  });

  await assist.accepts(cand("A"), {});
  // 프로젝트를 안 적었으면 붙여넣은 JSON 의 project_id 를 쓴다
  assert.match(decodeURI(String(lastCall().url)), /\/projects\/인라인-프로젝트\//);
  assert.equal(lastCall().init.headers.Authorization, "Bearer ya29.가짜");
});

// 서비스 계정 JSON 은 이 기능에서 가장 값비싼 비밀이다. 화면에도 응답에도 있으면 안 된다.
test("버텍스: 서비스 계정 키와 토큰이 밖으로 나가지 않는다", async () => {
  useFetch(async (url) => {
    if (String(url).includes("oauth2")) return { ok: true, status: 200, text: async () => '{"access_token":"ya29.진짜같은토큰","expires_in":3600}' };
    return { ok: false, status: 401, text: async () => "denied for token ya29.진짜같은토큰" };
  });
  googleAuth._reset();

  const shown = await assist.judgeTest({ provider: "vertex", model: "gemini-3-pro", location: "us-central1", project: "p" }, []);
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
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => "{}" };
  });

  await assist.listModels({ provider: "openai", baseUrl: "https://api.openai.com/v1" });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
});

test("유료 확인은 짧은 물음 하나만 보낸다 — 판정 프롬프트가 아니다", async () => {
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"안녕하세요. 42입니다."}}]}' };
  });

  const got = await assist.ping({ provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "gemma3n:e2b" });
  assert.equal(got.ok, true);
  assert.equal(got.answer, "안녕하세요. 42입니다.");

  const sent = calls[0]?.body;
  assert.ok(sent, "본문을 보냈다");
  assert.equal(sent.messages.length, 1, "한 마디만 보낸다");
  assert.equal(sent.messages[0].content, assist.PING_TEXT);
  assert.ok(!JSON.stringify(sent).includes("{{list}}"), "판정 프롬프트는 안 실린다");
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

// 모르는 이름은 검사가 짚는다(저장 · 기동 때 그 기능만 끈다). 그려 보는 길(미리보기)에서는 건드리지 않고 그대로 둔다 —
// 오타를 조용히 지우면 왜 사라졌는지 알 길이 없다
test("줄 형식의 모르는 자리표시자는 검사가 짚고, 그려 보면 그대로 남는다", async () => {
  useConfig(`${ON}list:\n  lineFormat: "{{title}} / {{아티스트}} / {{duration::m}}분"\n`, [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  answers('[{"n":1,"song":true,"fits":true}]');
  await assist.accepts(cand("Toxicity", 210), {});
  assert.equal(calls.length, 0, "검사에 걸린 설정이라 묻지 않는다");

  assert.deepEqual(assist.renderList({ list: { lineFormat: "{{title}} / {{아티스트}} / {{duration::m}}분" } }, [cand("Toxicity", 210)]), ["Toxicity / {{아티스트}} / 3분"]);
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

  const video = { title: "Girls Like You", durationSec: 200, channel: "Maroon5VEVO", artist: "Vevo" };
  await assist.accepts(video, { genre: "팝" });
  const asked = lastSent().body.messages[1].content;
  assert.ok(!asked.includes("Vevo"), asked);
  assert.ok(!asked.includes("Maroon5VEVO"), asked);
});

// ── 경로에 실제로 붙어 있는가 ─────────────────────────────────────────────

// 모듈이 멀쩡해도 배선이 빠지면 아무 일도 안 일어난다. 그 배선이 조용히 풀리는 것을 막는다.
test("키워드 경로에서만 묻는다", async () => {
  const limits = prepare({ minDurationSec: 0, maxDurationSec: null, blockedKeywords: [] });
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

// ── 화면이 보여주는 것과 실제로 나가는 것 ──────────────────────────────────

test("빈 섹션이 있어도 어느 섹션에서 나온 messages 인지 알 수 있다", async () => {
  // 화면이 섹션 이름표를 붙일 때 번호로 짝지으면, 빈 섹션 뒤의 것들이 한 칸씩 밀린다.
  const out = await assist.preview({
    provider: "custom",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "test-model",
    prompt: [
      { role: "system", text: "첫째" },
      { role: "user", text: "   " },
      { role: "user", text: "셋째 {{list}}" },
    ],
  });

  assert.equal(out.messages.length, 2, "빈 섹션은 나가지 않는다");
  assert.deepEqual(
    out.messages.map((one) => one.at),
    [0, 2],
    "원래 섹션 번호를 달고 나와야 한다",
  );
});

test("섹션 번호 표시는 저쪽에 보내는 본문에 섞이지 않는다", async () => {
  const out = await assist.preview({
    provider: "custom",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "test-model",
    prompt: [{ role: "user", text: "하나 {{list}}" }],
  });

  assert.ok(!JSON.stringify(out.body).includes('"at"'), "본문에 at 이 새면 저쪽이 400 을 줄 수 있다");
  for (const message of (out.body as SentBody).messages || []) {
    assert.deepEqual(Object.keys(message).sort(), ["content", "role"]);
  }
});

test("제미니 본문은 지시를 목록보다 앞에 둔다", async () => {
  // 저쪽은 이름 있는 칸이라 순서를 안 보지만, 요청 로그는 사람이 읽는다.
  const out = await assist.preview({
    provider: "aistudio",
    model: "gemini-test",
    prompt: [
      { role: "system", text: "판정 기준" },
      { role: "user", text: "{{list}}" },
    ],
  });

  const keys = Object.keys(out.body);
  assert.ok(keys.indexOf("systemInstruction") < keys.indexOf("contents"), `지시가 앞이어야 한다: ${keys.join(" → ")}`);
});

test("미리보기는 URL 을 돌려준다. 화면이 주소를 흉내 내지 않아도 되게", async () => {
  // 버텍스는 project·location 으로 조립하고 custom 은 끝 슬래시를 뗀다.
  // 클라이언트가 같은 계산을 다시 하면 어긋난다.
  const out = await assist.preview({ provider: "custom", baseUrl: "http://127.0.0.1:11434/v1///", model: "test-model" });
  assert.equal(out.url, "http://127.0.0.1:11434/v1/chat/completions");
});

// ── 묶음 실패 · 판정 읽기 ─────────────────────────────────────────────────

test("묶음 하나가 실패해도 앞 묶음의 판정은 살리고 남은 후보는 그대로 둔다", async () => {
  useConfig(`${ON.replace("batchSize: 10", "batchSize: 2")}`);
  let n = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    n++;
    if (n === 1) return { ok: true, json: async () => ({ choices: [{ message: { content: '[{"n":1,"song":false,"fits":true},{"n":2,"song":true,"fits":true}]' } }] }) };
    return { ok: false, status: 429, text: async () => "Resource exhausted" };
  });
  const got = await assist.filter([cand("A"), cand("B"), cand("C"), cand("D")], {});
  assert.deepEqual(
    got.map((c) => c.title),
    ["B", "C", "D"],
  );
});

test('답 앞뒤 설명에 대괄호가 있어도 판정 배열을 읽고, 글자 "false" 는 거짓이다', async () => {
  useConfig(ON);
  const list = [cand("A"), cand("B"), cand("C")];
  answers('Checking item [1] first.\n```json\n[{"n":1,"song":true,"fits":true},{"n":2,"song":"false","fits":"true"},{"n":3,"song":true,"fits":"false"}]\n```\nSee [3].');
  assert.deepEqual(
    (await assist.filter(list, {})).map((c) => c.title),
    ["A"],
  );
});

// ── 토큰 세기 ─────────────────────────────────────────────────────────────

test("판정 요청은 토큰을 세지 않는다(앤트로픽이어도 count_tokens 를 부르지 않는다)", async () => {
  useConfig("provider: anthropic\nmodel: claude-opus-5\n", [{ role: "user", text: "{{list}}" }]);
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    return { ok: true, json: async () => ({ content: [{ text: '[{"n":1,"song":true,"fits":true}]' }] }) };
  });
  await assist.filter([cand("A")], {});
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ["/v1/messages"],
  );
});

test("게이트웨이의 클로드 모델은 앤트로픽에 토큰을 묻지 않는다(그 키가 앤트로픽으로 나가지 않는다)", async () => {
  useConfig("provider: off\n");
  aiKeys.put("openrouter", KEY, assist.keyBinding({ provider: "openrouter" }));
  calls.length = 0;
  answers("[]");
  const shown = await assist.preview({ provider: "openrouter", model: "anthropic/claude-fable-5" });
  assert.deepEqual(calls, [], "미리보기는 밖으로 나가지 않는다");
  assert.equal(shown.tokens?.by, "tik");
});

test("버텍스 미리보기는 토큰을 받으러 나가지 않는다. 연결 확인은 토큰을 못 받으면 까닭을 돌려준다", async () => {
  useConfig("provider: vertex\nmodel: gemini-3.7-flash\nlocation: global\n", [{ role: "user", text: "{{list}}" }]);
  googleAuth._reset(); // 앞 시험이 받아 둔 토큰이 있으면 받으러 나가지 않아 시험이 안 된다
  calls.length = 0;
  useFetch(async (url, init) => {
    calls.push({ url, init, body: bodyOf(init) });
    throw new Error("network down");
  });
  const shown = await assist.preview({ provider: "vertex", model: "gemini-3.7-flash", location: "global", project: "p" });
  assert.deepEqual(calls, []);
  assert.match(shown.headers.Authorization, /^Bearer \[REDACTED/);

  const pinged = await assist.ping({ provider: "vertex", model: "gemini-3.7-flash", location: "global", project: "p" });
  assert.equal(pinged.ok, false);
  assert.match(String(pinged.reason), /network down/);

  const judged = await assist.judgeTest({ provider: "vertex", model: "gemini-3.7-flash", location: "global", project: "p" }, []);
  assert.equal(judged.status, null);
  assert.match(judged.response, /network down/);
});
