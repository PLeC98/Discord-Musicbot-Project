// src/, scripts/: 문구는 언어 폴더(locales/<언어>/)에 둔다. 그 밖의 한글 문자열을 파일마다 종류별(그 밖, 로그 계열, bug)로 세어(데이터는 빼고, test/helpers/text-outside)
// 기준표(text-outside.json)와 비교한다. 늘면 문구표, 규칙 문제로 옮기거나(그 밖은 화면, 디스코드 문구표, 로그 계열은 로그 문구표) 일어날 수 없는 일이면 bug(…)로. 옮겨서 줄면 기준표도 줄인다(다시 늘지 않게)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DATA_DECLARATIONS, DATA_FILES, LOG_CALLS_IN, koreanMap, koreanSites, rowsIn, type CountedKind, type KoreanCounts } from "../../helpers/text-outside.ts";

const BASELINE = path.join(import.meta.dirname, "text-outside.json");
const KINDS: readonly CountedKind[] = ["outside", "log", "bug"];

test("문구표 밖 한글 문자열이 종류마다 기준표보다 늘지 않고, 줄었으면 기준표도 줄였다", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Record<string, KoreanCounts>;
  const now = koreanMap();
  const more: string[] = [];
  const fewer: string[] = [];
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
    for (const kind of KINDS) {
      const was = baseline[file]?.[kind] ?? 0;
      const is = now[file]?.[kind] ?? 0;
      if (is > was) more.push(`${file} ${kind}: ${was} → ${is}`);
      if (is < was) fewer.push(`${file} ${kind}: ${was} → ${is}`);
    }
  }
  assert.deepEqual({ more, fewer }, { more: [], fewer: [] }, "more: 문구표, 규칙 문제로 옮기거나 일어날 수 없는 일이면 bug(…)로. fewer: test/ui/text/text-outside.json을 지금 수로 고친다");
});

test("로그 모양과 데이터는 그 밖으로 세지 않고, 사용자에게 보이는 모양의 글은 센다", () => {
  const source = [
    'const wlog = logger.child({ category: "watchdog" });',
    'const apiFailure = repeatingFailure(log, "조회");',
    'class GoneError extends Error { constructor() { super("세션이 끝남"); } }',
    'wlog.warn("로그 한 줄");',
    'log[level]("수준을 고른 로그");',
    'apiFailure.fail("실패 원인");',
    'throw new DOMException("시간 초과", "TimeoutError");',
    'requestPlayback(bot, { query, source: "로그 라벨" });',
    "db.exec(`-- SQL 주석`);",
    'await interaction.reply({ content: "사용자가 보는 글" });',
    'const label = { title: "사용자가 보는 제목" };',
  ].join("\n");
  assert.deepEqual(
    rowsIn("src/example.ts", source).map((one) => one.text),
    ["사용자가 보는 글", "사용자가 보는 제목"],
  );
});

test("스크립트 줄은 로그 계열, bug(…)의 글은 bug, 호출 밖에서 만든 글은 그 밖으로 센다", () => {
  const source = ['const say = scriptLine("ffmpeg");', 'say("info", "설치 완료");', 'scriptLine("install")("error", "설치 안 함");', 'throw bug("일어날 수 없는 상태");', 'const why = failed ? "빌드 실패" : "";'].join("\n");
  assert.deepEqual(
    koreanSites("scripts/example.ts", source).map((one) => [one.text, one.kind]),
    [
      ["설치 완료", "log"],
      ["설치 안 함", "log"],
      ["일어날 수 없는 상태", "bug"],
      ["빌드 실패", "outside"],
    ],
  );
});

test("데이터 목록과 파일 한정 목록이 가리키는 파일이 있다", () => {
  const files = [...Object.keys(DATA_FILES), ...Object.keys(DATA_DECLARATIONS), ...Object.keys(LOG_CALLS_IN)];
  assert.deepEqual(
    files.filter((file) => !fs.existsSync(path.join(import.meta.dirname, "..", "..", "..", file))),
    [],
  );
});
