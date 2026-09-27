// 보이는 재생 상태 요약. 명령(/nowplaying)과 대시보드가 같이 쓴다. 플레이어는 상태만 들고, 요약은 화면 쪽이 만든다

import { AudioPlayerStatus } from "@discordjs/voice";
import type { MusicPlayer } from "../player/Player.ts";

type StatusHost = Pick<MusicPlayer, "audioPlayer" | "volume" | "loop">;

/** 재생 중 · 멈춤 · 음량 · 반복 */
function playbackStatus(player: StatusHost) {
  const status = player.audioPlayer?.state?.status;
  return { playing: status === AudioPlayerStatus.Playing, paused: status === AudioPlayerStatus.Paused, volume: player.volume, loop: player.loop };
}

/** 소리가 실제로 물렸나(오디오 리소스가 붙은 상태). 곡을 여는 중이거나 멈췄으면 거짓. 여는 중에 곡을 보이면 유령 재생이 된다 */
function soundAttached(player: Pick<MusicPlayer, "audioPlayer">) {
  const status = player.audioPlayer?.state?.status;
  return status !== undefined && status !== AudioPlayerStatus.Idle;
}

export { playbackStatus, soundAttached };
