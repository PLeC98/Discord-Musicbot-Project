// 대시보드 서버가 세션과 앱(app.locals)에 매단 것

import type { Client, RESTAPIPartialCurrentUserGuild } from "discord.js";
import type { deployCommands } from "../../src/app/commandLoader.ts";
import type { Lookup } from "../../src/usecases/addTracks.ts";

/** 로그인한 사용자. OAuth 콜백이 세션에 담는다 */
type SessionUser = { id: string; username: string; globalName: string; avatar: string | null; guilds: RESTAPIPartialCurrentUserGuild[] };

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
    /** OAuth 요청과 콜백을 잇는 값 */
    oauthState: string;
    csrfToken: string;
    /** 권한 수준 오버라이드(viewAs) */
    viewAs: string;
  }
}

declare global {
  namespace Express {
    // app.locals 에 매단다. res.locals 는 쓰지 않는다
    interface Locals {
      discordClient: Client;
      /** 슬래시 명령 등록. 조립이 넘긴다 */
      deployCommands: typeof deployCommands;
      /** 곡 찾기. 시험이 가짜를 넘기는 자리. 없으면 진짜 */
      lookup?: Lookup;
    }
  }
}

export type { SessionUser };
