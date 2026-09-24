// 설정 파일 검사 문구를 고정한다(config/schema 의 zod 스키마).
//
// 문구는 무엇을 고쳐야 하는지까지 알려 주므로 한 글자도 바뀌면 안 된다. 입력마다 나오는 문구 목록을 차례까지 적었다.
// 여러 문제가 겹치면 칸 검사가 먼저, 교차 검사(이름 · 칸끼리 비교)가 뒤에 나온다. 던질지 경고할지는 부르는 쪽이 정한다(아래 셋째 묶음).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as genreConfig from "../../src/config/genres.ts";
import * as statusConfig from "../../src/config/status.ts";
import * as aiConfig from "../../src/config/ai.ts";
import * as yamlStore from "../../src/config/yamlStore.ts";
import assist from "../../src/autoplay/assist/index.js";
const { PROVIDERS } = assist; // 제공자가 늘어도 문구 표가 안 깨지게 목록에서 만든다

// [이름, 입력, 지금 나오는 문구]
const GENRES = [
  ["장르가 없다", {}, ["장르가 하나도 없습니다."]],
  [
    "YAML 이 값으로 읽는 이름 · 숫자 이름 · 이모지가 아닌 값",
    {
      genres: {
        80: {
          sources: [
            {
              type: "keyword",
              keywords: ["x"],
            },
          ],
        },
        true: {
          sources: [
            {
              type: "keyword",
              keywords: ["x"],
            },
          ],
        },
        가요: {
          sources: [
            {
              type: "keyword",
              keywords: ["x"],
            },
          ],
          emoji: "xx",
        },
      },
    },
    ["가요: emoji는 이모지 한 글자여야 합니다.", '"80": 숫자만으로 된 이름은 차례가 어긋납니다. "80년대"처럼 글자를 붙여 주세요.', '"true"는 장르 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).'],
  ],
  [
    "맨 위 keywords · 소스 없음",
    {
      genres: {
        옛모양: {
          keywords: ["a"],
        },
      },
    },
    ["옛모양: 맨 위 keywords: 는 더 이상 쓰지 않습니다. sources: 로 옮겨 주세요. sources: [{ type: keyword, keywords: [...] }]", "옛모양: 소스(sources)가 하나는 있어야 합니다."],
  ],
  [
    "소스 칸 문제",
    {
      genres: {
        소스: {
          sources: [
            null,
            {
              type: "nope",
            },
            {
              type: "keyword",
            },
            {
              type: "lbradio",
              tags: ["a"],
              mode: "insane",
            },
            {
              type: "anisongdb",
              songTypes: ["opening", "bad"],
            },
            {
              type: "keyword",
              keywords: ["x"],
              weight: 0,
              yearFrom: 2020,
              yearTo: 2000,
              minScore: -1,
              minLength: 300,
              maxLength: 60,
            },
          ],
        },
      },
    },
    [
      "소스의 1번째 소스: type과 값을 적어야 합니다.",
      "소스의 2번째 소스: 모르는 종류입니다(nope). 쓸 수 있는 것: keyword, lastfm, lbradio, animethemes, anisongdb, vocadb, utaitedb, touhoudb, spotify, youtube",
      "소스의 3번째 소스(키워드): keywords 를 적어야 합니다.",
      '소스의 4번째 소스(ListenBrainz Radio): mode에 "insane"는 쓸 수 없습니다. 쓸 수 있는 것: easy, medium, hard',
      '소스의 5번째 소스(AnisongDB): songTypes에 "bad"는 쓸 수 없습니다. 쓸 수 있는 것: opening, ending, insert',
      "소스의 6번째 소스: weight는 1 이상이어야 합니다.",
      "소스의 6번째 소스: minScore는 0 이상이어야 합니다.",
      "소스의 6번째 소스: yearFrom이 yearTo보다 큽니다.",
      "소스의 6번째 소스: minLength가 maxLength보다 큽니다.",
    ],
  ],
  [
    "기본값 문제",
    {
      genres: {
        가요: {
          sources: [
            {
              type: "keyword",
              keywords: ["x"],
            },
          ],
        },
      },
      defaults: {
        prefetchCount: 0,
        minDurationSec: -1,
        maxDurationSec: 0,
      },
    },
    ["prefetchCount는 1 이상이어야 합니다.", "minDurationSec은 0 이상이어야 합니다.", "maxDurationSec은 비우거나 0보다 커야 합니다."],
  ],
  [
    "기본값 길이 범위가 뒤집힘",
    {
      genres: {
        가요: {
          sources: [
            {
              type: "keyword",
              keywords: ["x"],
            },
          ],
        },
      },
      defaults: {
        minDurationSec: 300,
        maxDurationSec: 60,
      },
    },
    ["minDurationSec이 maxDurationSec보다 큽니다."],
  ],
];

const STATUSES = [
  [
    "문구가 없다 · interval 이 작다",
    {
      interval: 5,
    },
    ["interval은 10 이상이어야 합니다(초).", "평소 문구: 문구가 하나는 있어야 합니다."],
  ],
  [
    "문구 모양",
    {
      messages: [
        42,
        {
          text: "",
        },
        {
          text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        },
        {
          text: "ok",
          type: "Streaming",
        },
      ],
    },
    ["평소 문구: 문구는 글자로 적거나 text/type으로 풀어 적어야 합니다.", "평소 문구: 빈 문구가 있습니다.", '평소 문구: 문구가 128자를 넘습니다. "xxxxxxxxxxxxxxxxxxxx…"', '평소 문구: "Streaming"은 쓸 수 없는 활동 종류입니다(Playing · Listening · Watching · Competing · Custom).'],
  ],
  [
    "special 이 표가 아니다",
    {
      messages: ["ok"],
      special: ["a"],
    },
    ["special은 이름을 붙인 목록이어야 합니다."],
  ],
  [
    "special 이름 · 조건 · 범위",
    {
      messages: ["ok"],
      special: {
        2026: {
          time: "22:00 ~ 06:00",
          messages: ["a"],
        },
        true: {
          date: "12-24 ~ 12-26",
          messages: ["a"],
        },
        빈것: null,
        조건없음: {
          messages: ["a"],
        },
        범위: {
          date: "1-1 ~ 12-31",
          time: "25:00 ~ 01:00",
          lunar: "01-01",
          messages: ["a"],
        },
        숫자: {
          date: 1224,
          messages: [],
        },
      },
    },
    [
      "빈것: 내용이 비었습니다.",
      "조건없음: date · lunar · time 중 하나는 있어야 합니다(없으면 항상 이 문구만 나옵니다).",
      '범위의 date: "1-1"는 MM-DD 두 자리로 적어야 합니다',
      '범위의 lunar: "12-24 ~ 12-26"처럼 ~ 로 나눠 적어야 합니다',
      '범위의 time: "25:00"는 HH:MM 두 자리로 적어야 합니다',
      "숫자의 date: 글자로 적어야 합니다",
      "숫자: 문구가 하나는 있어야 합니다.",
      '"2026": 숫자만으로 된 이름은 차례가 어긋납니다. "2026년"처럼 글자를 붙여 주세요.',
      '"true"는 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).',
    ],
  ],
];

const AIS = [
  [
    "모르는 provider · 옛 enabled",
    {
      provider: "nope",
      enabled: true,
    },
    [`provider는 ${PROVIDERS.join(" · ")} 중 하나여야 합니다.`, "enabled 는 provider 로 바뀌었습니다. off 또는 openai 를 적으세요.", "model을 적어야 합니다."],
  ],
  [
    "custom 에 baseUrl 없음 · model 없음",
    {
      provider: "custom",
    },
    ["provider가 custom이면 baseUrl을 적어야 합니다.", "model을 적어야 합니다."],
  ],
  [
    "custom baseUrl 이 http 가 아님",
    {
      provider: "custom",
      baseUrl: "ftp://x",
      model: "m",
    },
    ["baseUrl은 http:// 또는 https:// 로 시작해야 합니다."],
  ],
  [
    "칸 모양",
    {
      provider: "off",
      temperature: 1,
      timeoutMs: 10,
      batchSize: 99,
      extra: 3,
      prompt: "x",
      project: 1,
      location: [],
      params: ["a"],
      hideModels: [1],
      promptNames: [2],
      list: [],
    },
    [
      "temperature는 params 아래에 모델별로 적습니다.",
      "timeoutMs는 1000~600000 사이여야 합니다.",
      "batchSize는 1~50 사이여야 합니다.",
      "extra는 한 줄에 하나씩 적는 글이어야 합니다.",
      "프롬프트는 ai-prompt.chatml 에 적습니다. ai.yaml 의 prompt 는 쓰이지 않습니다.",
      "project는 글자로 적어야 합니다.",
      "location는 글자로 적어야 합니다.",
      "params는 모델 이름 아래에 칸을 적는 표여야 합니다.",
      'hideModels는 글자 목록이어야 합니다(예: ["*sora*", "gpt-3.5*"]).',
      "promptNames는 글자 목록이어야 합니다.",
      "list는 이름:값 꼴이어야 합니다.",
    ],
  ],
  [
    "params 안쪽 · list 칸",
    {
      provider: "off",
      params: {
        m1: 5,
        m2: {
          a: 1,
        },
      },
      list: {
        lineFormat: "{{가수}}",
        unknownDuration: "maybe",
        unknownText: 1,
      },
    },
    ["params.m1 은 칸 이름과 값을 적는 표여야 합니다(모델 이름으로 한 겹 나눕니다).", "list.lineFormat에 {{제목}} 이 있어야 합니다.", "list.unknownDuration은 hide · text · zero 중 하나여야 합니다.", "list.unknownText는 글로 적어야 합니다."],
  ],
  [
    "list.lineFormat 이 글이 아님",
    {
      provider: "off",
      list: {
        lineFormat: 7,
      },
    },
    ["list.lineFormat은 글로 적어야 합니다."],
  ],
];

// [이름, 프롬프트 섹션, 켜 둠, 지금 나오는 문구]
const PROMPTS = [
  ["목록이 아님", "text", true, ["프롬프트는 섹션 목록이어야 합니다(역할과 내용을 가진 항목들)."]],
  [
    "섹션 모양",
    [
      null,
      {
        role: "bot",
        text: 1,
      },
      {
        role: "user",
        text: "<|im_end|>",
      },
    ],
    false,
    ["1번째 섹션: 역할과 내용을 적어야 합니다.", "2번째 섹션: 역할은 system · user · assistant 중 하나여야 합니다.", "2번째 섹션: 내용은 글로 적어야 합니다.", "3번째 섹션: 내용에 <|im_start|>·<|im_end|> 를 적을 수 없습니다."],
  ],
  [
    "켜 둔 채 {{목록}} 이 없음",
    [
      {
        role: "system",
        text: "안녕",
      },
    ],
    true,
    ["어딘가에 {{목록}} 이 있어야 합니다. 그 자리에 판정할 후보가 들어갑니다."],
  ],
  [
    "꺼 두면 {{목록}} 을 안 따진다",
    [
      {
        role: "system",
        text: "안녕",
      },
    ],
    false,
    [],
  ],
];

test("장르 검사: 장르가 25개를 넘는다(디스코드 선택 메뉴 한도)", () => {
  const genres = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`g${i}a`, { sources: [{ type: "keyword", keywords: ["x"] }] }]));
  assert.deepEqual(genreConfig.validateGenres({ genres }), ["장르가 26개입니다. 디스코드 선택 메뉴는 25개까지만 보여줍니다."]);
});

for (const [name, input, want] of GENRES) test(`장르 검사: ${name}`, () => assert.deepEqual(genreConfig.validateGenres(input), want));
for (const [name, input, want] of STATUSES) test(`상태 검사: ${name}`, () => assert.deepEqual(statusConfig.validateStatus(input), want));
for (const [name, input, want] of AIS) test(`AI 검사: ${name}`, () => assert.deepEqual(aiConfig.validateAi(input), want));
for (const [name, input, on, want] of PROMPTS) test(`프롬프트 검사: ${name}`, () => assert.deepEqual(aiConfig.promptProblems(input, on), want));

// ── 던지나 경고하나: 부르는 쪽이 정한다 ────────────────────────────────

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "config-messages-"));
const write = (name, text) => fs.writeFileSync(path.join(DIR, `${name}.yaml`), text);

before(() => yamlStore._setConfigDir(DIR));
after(() => {
  yamlStore._setConfigDir(path.join(import.meta.dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

test("장르 파일이 검사에 걸리면 던진다(기동이 멈춰야 한다). 문구는 한 줄씩 들여 쓴다", () => {
  write("genres", "genres:\n  가요:\n    sources: []\n");
  assert.throws(
    () => genreConfig.genres(),
    (e) => e.code === "CONFIG_INVALID" && e.message === ["config/genres.yaml 을 읽을 수 없습니다:", "   가요: 소스(sources)가 하나는 있어야 합니다."].join("\n"),
  );
});

test("상태 파일도 처음부터 검사에 걸리면 던진다. 문구는 장르와 같은 모양으로 한 줄씩", () => {
  statusConfig._reset();
  write("status", "interval: 5\nmessages: []\n");
  assert.throws(
    () => statusConfig.status(),
    (e) => e.code === "CONFIG_INVALID" && e.message === ["config/status.yaml 을 읽을 수 없습니다:", "   interval은 10 이상이어야 합니다(초).", "   평소 문구: 문구가 하나는 있어야 합니다."].join("\n"),
  );
});

test("AI 파일은 검사에 걸리면 끈 채로 돌려주고, 파일이 없으면 꺼진 것으로 본다", () => {
  write("ai", "provider: custom\n");
  assert.equal(aiConfig.ai().enabled, false);
  fs.rmSync(path.join(DIR, "ai.yaml"));
  yamlStore._cache.clear();
  assert.deepEqual(aiConfig.ai(), { enabled: false });
});
