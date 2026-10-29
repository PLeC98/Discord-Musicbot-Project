// dashboard/src/utils/prompt-file.ts: AI 판정 프롬프트 한 벌 내보내기 · 불러오기. 파일 형식, 다른 파일 거부, 망가진 섹션

import { test } from "node:test";
import assert from "node:assert/strict";
import { promptFile, parsePromptFile } from "../../../dashboard/src/utils/prompt-file.ts";

const SECTIONS = [
  { role: "system", name: "규칙", text: "판정한다." },
  { role: "user", name: "", text: "{{list}}" },
];

test("내보낸 파일을 그대로 불러오면 같은 줄 형식 · 섹션이 된다", () => {
  const { name, body } = promptFile("{{index}}. {{title}}", SECTIONS);
  assert.equal(name, "ai-prompt.json");
  assert.deepEqual(parsePromptFile(body), { lineFormat: "{{index}}. {{title}}", sections: SECTIONS, dropped: 0 });
});

test("프롬프트 파일이 아니면 null", () => {
  for (const text of ["not json", "null", "[]", '{"sections":[]}', '{"musicbotPrompt":2,"sections":[]}', '{"musicbotPrompt":1,"sections":{}}', '{"musicbotGenre":1,"id":"pop","genre":{}}']) {
    assert.equal(parsePromptFile(text), null, text);
  }
});

test("객체가 아닌 섹션만 빼고, 역할이 틀린 것은 남긴다(편집기 · 저장 검사가 잡는다)", () => {
  const got = parsePromptFile(JSON.stringify({ musicbotPrompt: 1, sections: [{ role: "narrator", text: "x" }, null, "junk", [1], { role: "user", text: 5 }] }));
  assert.deepEqual(got, {
    lineFormat: "",
    sections: [
      { role: "narrator", name: "", text: "x" },
      { role: "user", name: "", text: "5" },
    ],
    dropped: 3,
  });
});
