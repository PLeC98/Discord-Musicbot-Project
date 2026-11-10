// dashboard/src/utils/discord-markdown.ts: 공지 미리보기의 마크다운. 화면은 CSP로 style 속성을 막으므로 스타일은 클래스로만 지정한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { discordMarkdown } from "../../../dashboard/src/utils/discord-markdown.ts";

test("중첩 목록: 앞 공백 2칸마다 한 단계씩(2단계까지) 클래스를 붙이고, style 속성은 쓰지 않는다", () => {
  const html = discordMarkdown("- 하나\n  - 둘\n    - 셋\n      - 넷\n1. 첫째\n  2. 둘째");
  assert.equal(html, '<ul class="dmd-ul"><li>하나</li><li class="dmd-depth-1">둘</li><li class="dmd-depth-2">셋</li><li class="dmd-depth-2">넷</li></ul><ol class="dmd-ol" start="1"><li>첫째</li><li class="dmd-depth-1">둘째</li></ol>');
  assert.doesNotMatch(html, /style=/);
});
