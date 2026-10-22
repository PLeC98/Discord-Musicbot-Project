// 슬래시 명령 전부. 새 명령은 여기에 더한다(app/command-loader 가 이 목록으로 등록 · 배포한다). 폴더의 파일과 같은지는 테스트(test/app/moduleLists)가 본다

import autoplay from "./autoplay.ts";
import cachestatus from "./cachestatus.ts";
import clear from "./clear.ts";
import dashboard from "./dashboard.ts";
import help from "./help.ts";
import highlight from "./highlight.ts";
import join from "./join.ts";
import leave from "./leave.ts";
import license from "./license.ts";
import loop from "./loop.ts";
import move from "./move.ts";
import nowplaying from "./nowplaying.ts";
import pause from "./pause.ts";
import ping from "./ping.ts";
import play from "./play.ts";
import playfirst from "./playfirst.ts";
import previous from "./previous.ts";
import queue from "./queue.ts";
import remove from "./remove.ts";
import replay from "./replay.ts";
import search from "./search.ts";
import seek from "./seek.ts";
import setchannel from "./setchannel.ts";
import setting from "./setting.ts";
import setdjrole from "./setdjrole.ts";
import setplaylistlimit from "./setplaylistlimit.ts";
import shuffle from "./shuffle.ts";
import skip from "./skip.ts";
import sponsorblock from "./sponsorblock.ts";
import stop from "./stop.ts";
import system from "./system.ts";
import volume from "./volume.ts";
import type { SlashCommand } from "../../app/command-loader.ts";

// 순서가 곧 /help 의 순서다(그룹 안에서 위에서 아래로)
const COMMANDS: readonly SlashCommand[] = [play, playfirst, pause, stop, skip, previous, replay, seek, highlight, queue, clear, remove, move, shuffle, loop, autoplay, volume, search, nowplaying, join, leave, setchannel, setting, setdjrole, setplaylistlimit, sponsorblock, dashboard, ping, system, cachestatus, license, help];

export { COMMANDS };
