// dashboard/src/composables/docs.ts — 화면에서 저장소 설명서(docs/)로 가는 주소. 기본 가지(HEAD)를 보고, 꼴을 모르는 곳은 잇지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { setDocsRepo, docUrl } from "../../../dashboard/src/composables/docs.ts";

test("GitHub · GitLab 은 기본 가지의 파일로 잇는다(끝의 / · .git 은 뗀다)", () => {
  setDocsRepo("https://github.com/PLeC98/Discord-Musicbot-Project.git");
  assert.equal(docUrl("docs/favicon.md"), "https://github.com/PLeC98/Discord-Musicbot-Project/blob/HEAD/docs/favicon.md");
  setDocsRepo("https://gitlab.com/someone/bot/");
  assert.equal(docUrl("docs/settings-data.md"), "https://gitlab.com/someone/bot/-/blob/HEAD/docs/settings-data.md");
});

test("저장소를 모르거나 꼴을 모르는 곳이면 null(링크를 두지 않는다)", () => {
  for (const url of ["", "주소 아님", "https://git.example.com/me/bot", null]) {
    setDocsRepo(url);
    assert.equal(docUrl("docs/favicon.md"), null, String(url));
  }
});
