// 화면 문구표. 언어마다 같은 모양의 모듈(text/<언어>/)을 두고 여기서 고른다(지금은 한국어 하나, 다국어를 들이면 고른 언어의 것을 낸다).
// 말투는 해요체, 버튼 · 제목은 명사형, 툴팁은 짧게, 화면 읽기 이름(aria-label)은 무엇인지 드러나게.
// 봇과 같은 뜻의 문장(거절 · 오류 · 이름표)은 여기 두지 않고 봇 문장표(src/ui/text/ko/)에서 부른다

import * as admin from "./ko/admin.ts";
import * as common from "./ko/common.ts";
import * as editor from "./ko/editor.ts";
import * as errors from "./ko/errors.ts";
import * as fields from "./ko/fields.ts";
import * as player from "./ko/player.ts";
import * as presence from "./ko/presence.ts";
import * as server from "./ko/server.ts";
import * as servers from "./ko/servers.ts";
import * as shell from "./ko/shell.ts";

const text = { admin, common, editor, errors, fields, player, presence, server, servers, shell };

export { text };
