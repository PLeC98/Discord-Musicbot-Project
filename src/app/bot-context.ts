// 조립(app/main)이 한 번 만들어 진입점(명령 · 처리기 · 이벤트 · 대시보드)에 넘기는 것. 디스코드 클라이언트에 매달지 않는다.
// 아래층(usecases · ui · player)은 이것을 통째로 받지 않고 쓰는 필드만 받는다.

import type { Client } from "discord.js";
import type { PlayerRegistry } from "../player/registry.ts";
import type { NowPlayingPanel } from "../ui/now-playing-panel.ts";
import type { SlashCommand } from "./command-loader.ts";

type BotContext = {
  client: Client;
  /** 서버마다 플레이어 하나 */
  players: PlayerRegistry;
  /** 재생 패널 */
  panels: NowPlayingPanel;
  /** 켜진 슬래시 명령. 이름으로 */
  commands: ReadonlyMap<string, SlashCommand>;
};

export type { BotContext };
