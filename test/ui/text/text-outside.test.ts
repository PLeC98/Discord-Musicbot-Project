// src/: 사용자에게 보이는 문구는 언어 폴더(locales/<언어>/)에 둔다. 그 밖의 한글 문자열을 파일마다 세어(로그와 예외 메시지는 빼고, test/helpers/text-outside)
// 기준표(text-outside.json)와 비교한다. 늘면 문구표로 옮기거나 로그 호출 안에서 만든다. 옮겨서 줄면 기준표도 줄인다(다시 늘지 않게)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { textOutside } from "../../helpers/text-outside.ts";

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
