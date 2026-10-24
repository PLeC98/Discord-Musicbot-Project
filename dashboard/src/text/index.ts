// 화면 문구표. 언어마다 같은 모양의 모듈(text/<언어>/)을 두고 여기서 고른다(지금은 한국어 하나, 다국어를 들이면 고른 언어의 것을 낸다).
// 말투는 해요체, 버튼 · 제목은 명사형, 툴팁은 짧게, 화면 읽기 이름(aria-label)은 무엇인지 드러나게.
// 봇과 같은 뜻의 문장(거절 · 오류 · 이름표)은 여기 두지 않고 봇 문장표(src/ui/text/ko/)에서 부른다

import * as admin from "./ko/admin.ts";
import * as ageContent from "./ko/age-content.ts";
import * as ai from "./ko/ai.ts";
import * as appearance from "./ko/appearance.ts";
import * as archive from "./ko/archive.ts";
import * as cacheDb from "./ko/cache-db.ts";
import * as commands from "./ko/commands.ts";
import * as common from "./ko/common.ts";
import * as cookies from "./ko/cookies.ts";
import * as dev from "./ko/dev.ts";
import * as editor from "./ko/editor.ts";
import * as errors from "./ko/errors.ts";
import * as fields from "./ko/fields.ts";
import * as genres from "./ko/genres.ts";
import * as geoip from "./ko/geoip.ts";
import * as invite from "./ko/invite.ts";
import * as licenses from "./ko/licenses.ts";
import * as login from "./ko/login.ts";
import * as loginBackground from "./ko/login-background.ts";
import * as logs from "./ko/logs.ts";
import * as manage from "./ko/manage.ts";
import * as more from "./ko/more.ts";
import * as player from "./ko/player.ts";
import * as presence from "./ko/presence.ts";
import * as restart from "./ko/restart.ts";
import * as server from "./ko/server.ts";
import * as serverSettings from "./ko/server-settings.ts";
import * as servers from "./ko/servers.ts";
import * as serviceKeys from "./ko/service-keys.ts";
import * as settings from "./ko/settings.ts";
import * as shell from "./ko/shell.ts";
import * as reset from "./ko/reset.ts";
import * as snapshots from "./ko/snapshots.ts";
import * as status from "./ko/status.ts";
import * as tunables from "./ko/tunables.ts";

const text = { admin, ageContent, ai, appearance, archive, cacheDb, commands, common, cookies, dev, editor, errors, fields, genres, geoip, invite, licenses, login, loginBackground, logs, manage, more, player, presence, reset, restart, server, serverSettings, servers, serviceKeys, settings, shell, snapshots, status, tunables };

export { text };
