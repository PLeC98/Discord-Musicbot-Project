// src/infra/script-line.ts: 터미널 스크립트의 한 줄(봇 로그와 같은 모양). 글이나 로그 문구 서술자를 받고, 봇이 옮겨 적을 때 앞머리를 뗀다

import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptLine, stripScriptPrefix } from "../../src/infra/script-line.ts";
import { L } from "../../src/infra/log/text.ts";
import { renderLogText } from "../../src/infra/log/log-text.ts";

/** console.log, console.error로 나간 줄을 모은다 */
function printed(run: () => void): { out: string[]; err: string[] } {
  const seen = { out: [] as string[], err: [] as string[] };
  const { log, error } = console;
  console.log = (line: string) => void seen.out.push(line);
  console.error = (line: string) => void seen.err.push(line);
  try {
    run();
  } finally {
    Object.assign(console, { log, error });
  }
  return seen;
}

test("앞머리는 수준과 분류, info는 표준 출력, warn과 error는 표준 오류", () => {
  const say = scriptLine("ffmpeg");
  const seen = printed(() => {
    say("info", "하나");
    say("warn", "둘");
    say("error", "셋");
  });
  assert.deepEqual(seen, { out: ["INFO  [ffmpeg] 하나"], err: ["WARN  [ffmpeg] 둘", "ERROR [ffmpeg] 셋"] });
});

test("로그 문구 서술자는 로그 언어로 그려 찍고, 봇은 앞머리만 떼어 옮겨 적는다", () => {
  const text = L.config.tunablesApplyFailed({ error: "디스크가 가득 찼습니다" });
  const seen = printed(() => scriptLine("setup")("warn", text));
  assert.deepEqual(seen.err, [`WARN  [setup] ${renderLogText(text)}`]);
  assert.equal(stripScriptPrefix(seen.err[0]), renderLogText(text));
});
