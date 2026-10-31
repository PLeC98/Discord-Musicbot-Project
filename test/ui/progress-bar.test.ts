// src/ui/progress-bar.ts: 재생 패널의 진행 막대(위치, 막대, 길이)

import { test } from "node:test";
import assert from "node:assert/strict";
import { progressBar } from "../../src/ui/progress-bar.ts";

test("진행 막대: 위치, 채운 칸, 길이의 지금 답", () => {
  // 위치가 길이를 넘으면(표시 길이가 실제 음원과 다를 때) 글자는 넘은 위치 그대로다
  assert.equal(progressBar(203, 200), "`3:23` ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬● `3:20`");
  // 채운 칸은 비율을 반올림한다: 끝 5초 전에 이미 다 찬다
  assert.equal(progressBar(195, 200), "`3:15` ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬● `3:20`");
  assert.equal(progressBar(100, 200), "`1:40` ▬▬▬▬▬▬▬▬●▬▬▬▬▬▬▬▬ `3:20`");
  // 길이를 모르면 막대는 비우고 길이는 --:--
  assert.equal(progressBar(0, 0), "`0:00` ●▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ `--:--`");
  assert.equal(progressBar(30, 0), "`0:30` ●▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ `--:--`");
});
