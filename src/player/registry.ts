import { Collection } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "registry" });
import type MusicPlayer from "./Player.ts";

/**
 * client.players를 감싸 등록, 해제를 전부 기록
 *
 * 봇이 음성 채널에 남아 소리를 내고 있는데 레지스트리는 비어 있는 사례를 쫓기 위한 관측용
 * (곡 추가가 409, /nowplaying이 "재생 중인 곡 없음"). 지우는 경로가 여러 파일에 흩어져 있고
 * 아직 찾지 못한 경로가 있을 수 있어, 호출부마다 로그를 다는 대신 맵 자체를 감쌌다.
 */

// 스택에서 이 파일 바깥 첫 프레임을 "파일:줄"로 뽑는다. 경로 구분자는 미리 /로 통일.
function caller() {
  const frames = (new Error().stack || "").split("\n").slice(2);
  for (const raw of frames) {
    if (raw.includes("playerRegistry")) continue;
    const frame = raw.split("\\").join("/");
    const withDir = frame.match(/([^/]+\/[^/]+):(\d+):\d+\)?\s*$/);
    if (withDir) return `${withDir[1]}:${withDir[2]}`;
    const bare = frame.match(/([^/(\s]+):(\d+):\d+\)?\s*$/);
    if (bare) return `${bare[1]}:${bare[2]}`;
  }
  return "?";
}

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
}

export default PlayerRegistry;
export { PlayerRegistry as "module.exports" };
