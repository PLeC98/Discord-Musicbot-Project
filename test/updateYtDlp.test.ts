// scripts/update-ytdlp.ts — yt-dlp -U 는 올렸을 때도 이미 최신일 때도 0, 받기 실패면 100 으로 끝난다.
// 종료 코드로는 실패만 가르고, 올렸는지는 앞뒤 판으로 가른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeUpdate, updateYtDlp } from "../scripts/update-ytdlp.ts";

// 가짜 바이너리. -U 를 부를 때마다 판을 바꾸거나(올림) 그대로 두거나, 실패 코드를 낸다
function binary({ from, to, status = 0 }: { from: string; to: string; status?: number }) {
  let current = from;
  const calls: string[] = [];
  const run = (args: string[]) => {
    calls.push(args.join(" "));
    if (args[0] === "--version") return { status: 0, stdout: `${current}\n` };
    if (status === 0) current = to;
    return { status };
  };
  return { run, calls };
}

test("올렸으면 앞뒤 판을, 이미 최신이면 그렇다고, 실패면 종료 코드와 지금 판을 알린다", () => {
  const up = binary({ from: "2026.08.19", to: "2026.09.20" });
  assert.deepEqual(updateYtDlp(up.run), { level: "info", line: "✅ yt-dlp 를 올렸습니다: 2026.08.19 → 2026.09.20" });
  assert.deepEqual(up.calls, ["--version", "-U", "--version"]);

  assert.deepEqual(updateYtDlp(binary({ from: "2026.09.20", to: "2026.09.20" }).run), { level: "info", line: "✅ yt-dlp 가 이미 최신입니다(2026.09.20)." });

  const failed = binary({ from: "2026.08.19", to: "x", status: 100 });
  assert.deepEqual(updateYtDlp(failed.run), { level: "warn", line: "⚠️  yt-dlp 업데이트 실패(종료 코드 100). 지금 판(2026.08.19)으로 계속합니다." });
  assert.deepEqual(failed.calls, ["--version", "-U"], "실패하면 판을 다시 묻지 않는다");
});

test("판을 읽지 못해도 결과는 알린다", () => {
  assert.deepEqual(describeUpdate(null, 0, null), { level: "info", line: "✅ yt-dlp 업데이트를 마쳤습니다(판을 읽지 못했습니다)." });
  assert.equal(describeUpdate(null, null, null).line, "⚠️  yt-dlp 업데이트 실패(종료 코드 없음). 지금 판으로 계속합니다.");
});
