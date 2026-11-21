// src/: 사용자에게 보이는 문구는 언어 폴더(locales/<언어>/)에 둔다. 그 밖의 한글 문자열을 파일마다 세어(로그, 예외 메시지, 데이터는 빼고, test/helpers/text-outside)
// 기준표(text-outside.json)와 비교한다. 늘면 문구표로 옮기거나 로그 호출 안에서 만든다. 옮겨서 줄면 기준표도 줄인다(다시 늘지 않게)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DATA_DECLARATIONS, DATA_FILES, LOG_CALLS_IN, rowsIn, textOutside } from "../../helpers/text-outside.ts";

const BASELINE = path.join(import.meta.dirname, "text-outside.json");

test("언어 모듈 밖의 한글 문자열이 기준표보다 늘지 않고, 줄었으면 기준표도 줄였다", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Record<string, number>;
  const now = textOutside();
  const more = Object.entries(now)
    .filter(([file, n]) => n > (baseline[file] ?? 0))
    .map(([file, n]) => `${file}: ${baseline[file] ?? 0} → ${n}`);
  const fewer = Object.entries(baseline)
    .filter(([file, n]) => (now[file] ?? 0) < n)
    .map(([file, n]) => `${file}: ${n} → ${now[file] ?? 0}`);
  assert.deepEqual({ more, fewer }, { more: [], fewer: [] }, "more: 문구표로 옮기거나 로그 호출 안에서 만든다. fewer: test/ui/text/text-outside.json을 지금 수로 고친다");
});

test("로그 모양과 데이터는 세지 않고, 사용자에게 보이는 모양의 글은 센다", () => {
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

test("데이터 목록과 파일 한정 목록이 가리키는 파일이 있다", () => {
  const files = [...Object.keys(DATA_FILES), ...Object.keys(DATA_DECLARATIONS), ...Object.keys(LOG_CALLS_IN)];
  assert.deepEqual(
    files.filter((file) => !fs.existsSync(path.join(import.meta.dirname, "..", "..", "..", file))),
    [],
  );
});
