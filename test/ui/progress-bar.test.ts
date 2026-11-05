// src/ui/progress-bar.ts: 재생 패널의 진행 막대(위치, 막대, 길이)

import { test } from "node:test";
import assert from "node:assert/strict";
import { progressBar } from "../../src/ui/progress-bar.ts";

const bar = (filled: number) => `${"▬".repeat(filled)}●${"▬".repeat(16 - filled)}`;

test("진행 막대: 위치는 길이에서 멈추고, 채운 칸은 내림이라 끝에 닿아야 다 찬다", () => {
  // 표시 길이는 실제 음원과 몇 초 다를 수 있다. 위치가 길이를 넘어도 글자는 길이에서 멈춘다(대시보드와 같다)
  assert.equal(progressBar(203, 200), `\`3:20\` ${bar(16)} \`3:20\``);
  assert.equal(progressBar(200, 200), `\`3:20\` ${bar(16)} \`3:20\``);
  assert.equal(progressBar(195, 200), `\`3:15\` ${bar(15)} \`3:20\``);
  assert.equal(progressBar(100, 200), `\`1:40\` ${bar(8)} \`3:20\``);
  assert.equal(progressBar(0, 200), `\`0:00\` ${bar(0)} \`3:20\``);
  assert.equal(progressBar(-5, 200), `\`0:00\` ${bar(0)} \`3:20\``);
  assert.equal(progressBar(NaN, 200), `\`0:00\` ${bar(0)} \`3:20\``);
});

test("진행 막대: 길이를 모르면 핸들을 맨 앞에 두고 길이는 --:--, 라이브는 표식만", () => {
  assert.equal(progressBar(0, 0), `\`0:00\` ${bar(0)} \`--:--\``);
  assert.equal(progressBar(30, 0), `\`0:30\` ${bar(0)} \`--:--\``);
  assert.equal(progressBar(30, NaN), `\`0:30\` ${bar(0)} \`--:--\``);
  assert.equal(progressBar(30, 200, { live: true }), `\`🔴LIVE\` ${"▬".repeat(17)} \`-:--\``);
});
