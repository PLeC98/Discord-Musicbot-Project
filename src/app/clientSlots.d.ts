// 조립(main)이 디스코드 클라이언트에 매단 것. 어디서든 client 로 찾아 쓴다.

import type PlayerRegistry from "../player/registry.ts";

declare module "discord.js" {
  interface Client {
    /** 서버마다 플레이어 하나 */
    players: PlayerRegistry;
  }
}
