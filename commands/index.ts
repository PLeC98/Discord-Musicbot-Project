// 슬래시 명령 전부. 새 명령은 여기에 더한다(app/commandLoader 가 이 목록으로 등록 · 배포한다). 폴더의 파일과 같은지는 시험(test/app/moduleLists)이 본다

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
import setdjrole from "./setdjrole.ts";
import setplaylistlimit from "./setplaylistlimit.ts";
import shuffle from "./shuffle.ts";
import skip from "./skip.ts";
import sponsorblock from "./sponsorblock.ts";
import stop from "./stop.ts";
import system from "./system.ts";
import volume from "./volume.ts";
import type { SlashCommand } from "../src/app/commandLoader.ts";

const COMMANDS: readonly SlashCommand[] = [autoplay, cachestatus, clear, dashboard, help, highlight, join, leave, license, loop, move, nowplaying, pause, ping, play, playfirst, previous, queue, remove, replay, search, seek, setchannel, setdjrole, setplaylistlimit, shuffle, skip, sponsorblock, stop, system, volume];

export { COMMANDS };
