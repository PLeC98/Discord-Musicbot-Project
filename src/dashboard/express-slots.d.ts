// 대시보드 서버가 세션과 앱(app.locals)에 매단 것

import type { RESTAPIPartialCurrentUserGuild } from "discord.js";
import type { BotContext } from "../app/bot-context.ts";
import type { deployCommands } from "../app/command-loader.ts";
import type { Lookup } from "../usecases/add-tracks.ts";
import type { Tier } from "./contract/identity.ts";
import type { PlayerStream } from "./player-stream.ts";

/** 로그인한 사용자. OAuth 콜백이 세션에 담는다 */
type SessionUser = { id: string; username: string; globalName: string; avatar: string | null; guilds: RESTAPIPartialCurrentUserGuild[] };

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
    /** 디스코드로 로그인한 때. 세션을 새로 만들 때 한 번 적고 요청마다 갱신하지 않는다(middleware/recent-login) */
    loginAt: number;
    /** OAuth 요청과 콜백을 잇는 값 */
    oauthState: string;
    csrfToken: string;
    /** 권한 수준 오버라이드(viewAs). 세션 저장소에서 읽은 값이라 쓰는 곳은 getViewAs 로 다시 본다 */
    viewAs: Tier;
  }
}

declare global {
  namespace Express {
    // app.locals 에 매단다. res.locals 는 쓰지 않는다
    interface Locals {
      /** 디스코드 클라이언트 · 플레이어 · 패널. 조립이 넘긴다 */
      bot: BotContext;
      /** 슬래시 명령 등록. 조립이 넘긴다 */
      deployCommands: typeof deployCommands;
      /** 플레이어 실시간 알림(대시보드 연결). 조립이 넘긴다 */
      stream: PlayerStream;
      /** 봇 다시 시작(세션을 저장하고 나가면 실행기가 다시 띄운다). 실행기 없이 켰으면 null. by: 누가(로그) */
      restart: ((by: string) => void) | null;
      /** 곡 찾기. 시험이 가짜를 넘기는 자리. 없으면 진짜 */
      lookup?: Lookup;
    }
  }
}

export type { SessionUser };
