// 음량을 바꾼 결과 화면. 명령(/volume)과 패널 버튼의 입력 창이 같은 것을 쓴다.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { volumeChanged } from "../../src/ui/volumeReply.ts";

test("이전 → 지금을 보이고 막대는 없다. 같으면 그대로라고 말한다", () => {
  const changed = volumeChanged({ before: 80, level: 35, by: "<@1>" }).toJSON();
  assert.equal(changed.title, "🔊 볼륨이 변경되었습니다");
  assert.equal(changed.description, "**80%** → **35%**");
  assert.deepEqual(changed.fields, [{ name: "👤 변경한 사람", value: "<@1>", inline: true }]);

  assert.equal(volumeChanged({ before: 35, level: 35, by: "<@1>" }).toJSON().description, "볼륨은 그대로 **35%**입니다.");
});

test("명령과 입력 창이 같은 화면을 쓴다(따로 그리지 않는다)", () => {
  const root = path.join(import.meta.dirname, "..", "..");
  for (const file of ["commands/volume.ts", "events/modalHandler.ts"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(src, /volumeChanged\(/, file);
    assert.doesNotMatch(src, /[█▓░]/, `${file} 에 막대가 남았다`);
  }
});
