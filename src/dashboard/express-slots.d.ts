// 대시보드 서버가 세션과 앱(app.locals)에 매단 것

import type { RESTAPIPartialCurrentUserGuild } from "discord.js";
import type { BotContext } from "../app/bot-context.ts";
import type { deployCommands } from "../app/command-loader.ts";
import type { Lookup } from "../usecases/add-tracks.ts";
import type { Tier } from "./view-as.ts";

/** 로그인한 사용자. OAuth 콜백이 세션에 담는다 */
type SessionUser = { id: string; username: string; globalName: string; avatar: string | null; guilds: RESTAPIPartialCurrentUserGuild[] };

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
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
      /** 곡 찾기. 시험이 가짜를 넘기는 자리. 없으면 진짜 */
      lookup?: Lookup;
    }
  }
}

export type { SessionUser };
