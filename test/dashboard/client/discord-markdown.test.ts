// dashboard/src/utils/discord-markdown.ts: 공지 미리보기의 마크다운. 화면은 CSP 로 style 속성을 막으므로 꾸밈은 클래스로만

import { test } from "node:test";
import assert from "node:assert/strict";
import { discordMarkdown } from "../../../dashboard/src/utils/discord-markdown.ts";

test("중첩 목록: 앞 공백 2칸마다 한 단계(두 단계까지)를 클래스로, style 속성은 없다", () => {
  const html = discordMarkdown("- 하나\n  - 둘\n    - 셋\n      - 넷\n1. 첫째\n  2. 둘째");
  assert.equal(html, '<ul class="dmd-ul"><li>하나</li><li class="dmd-depth-1">둘</li><li class="dmd-depth-2">셋</li><li class="dmd-depth-2">넷</li></ul><ol class="dmd-ol" start="1"><li>첫째</li><li class="dmd-depth-1">둘째</li></ol>');
  assert.doesNotMatch(html, /style=/);
});
