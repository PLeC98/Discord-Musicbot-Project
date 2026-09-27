import { Collection } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "registry" });
import type { MusicPlayer } from "./Player.ts";
import * as playerEvents from "./events.ts";

/**
 * 서버마다 플레이어 하나(client.players). 등록 · 해제를 부른 자리와 함께 기록한다.
 *
 * 빼는 길은 플레이어를 버릴 때 오는 알림 하나다(followDisposals → forget). 그 서버에 새 플레이어가
 * 이미 들어와 있으면 늦게 버려진 옛 플레이어가 새것을 빼지 않는다.
 */

// 이 파일의 경로. 스택에서 이 파일의 프레임을 건너뛰는 데 쓴다(파일 이름을 적어 두면 옮길 때 어긋난다)
const SELF = import.meta.filename.split("\\").join("/");

// 스택에서 이 파일 바깥 첫 프레임을 "파일:줄"로 뽑는다. 경로 구분자는 미리 /로 통일.
function callerOf(stack: string, self = SELF) {
  for (const raw of stack.split("\n").slice(1)) {
    const frame = raw.split("\\").join("/");
    if (frame.includes(self)) continue;
    const withDir = frame.match(/([^/]+\/[^/]+):(\d+):\d+\)?\s*$/);
    if (withDir) return `${withDir[1]}:${withDir[2]}`;
    const bare = frame.match(/([^/(\s]+):(\d+):\d+\)?\s*$/);
    if (bare) return `${bare[1]}:${bare[2]}`;
  }
  return "?";
}

const caller = () => callerOf(new Error().stack || "");

const label = (player: MusicPlayer | undefined, guildId: string) => `${player?.guild?.name ?? "?"} (${guildId})`;

class PlayerRegistry extends Collection<string, MusicPlayer> {
  set(guildId: string, player: MusicPlayer) {
    log.debug(`등록: ${label(player, guildId)}${this.has(guildId) ? " | 기존 항목 교체" : ""} | ${caller()}`);
    return super.set(guildId, player);
  }

  delete(guildId: string) {
    const prev = this.get(guildId);
    if (prev) {
      const track = prev.currentTrack ? `"${prev.currentTrack.title}"` : "없음";
      const conn = prev.connection?.state?.status ?? "없음";
      log.debug(`해제: ${label(prev, guildId)} | 재생중=${track} | 연결=${conn} | ${caller()}`);
    }
    return super.delete(guildId);
  }

  /** 버려진 플레이어를 뺀다. 그 서버에 이미 다른(새) 플레이어가 있으면 건드리지 않는다 */
  forget(player: MusicPlayer) {
    const guildId = player.guild?.id;
    if (guildId && this.get(guildId) === player) this.delete(guildId);
  }

  /** 플레이어가 버려지면 스스로 뺀다. 떼는 함수를 돌려준다 */
  followDisposals() {
    return playerEvents.on("disposed", (player) => this.forget(player));
  }
}

export { PlayerRegistry, callerOf, caller };
