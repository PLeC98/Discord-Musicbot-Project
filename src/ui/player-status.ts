// 보이는 재생 상태 요약. 명령(/nowplaying)과 대시보드가 같이 쓴다. 플레이어는 상태만 들고, 요약은 화면 쪽이 만든다

import { AudioPlayerStatus } from "@discordjs/voice";
import type { Player } from "../player/player.ts";

type StatusHost = Pick<Player, "audioPlayer" | "volume" | "loop" | "paused">;

/** 재생 중 · 멈춤 · 볼륨 · 반복. 멈춤은 플레이어의 값(사람의 뜻 · 억제 사유)이다. 곡을 여는 중에도 멈춰 있어야 하면 멈춤으로 보인다 */
function playbackStatus(player: StatusHost) {
  const status = player.audioPlayer?.state?.status;
  return { playing: status === AudioPlayerStatus.Playing && !player.paused, paused: player.paused, volume: player.volume, loop: player.loop };
}

/**
 * 곡을 보일까: 소리가 실제로 물렸나(오디오 리소스가 붙은 상태). 곡을 여는 중이거나 멈췄으면 거짓. 여는 중에 곡을 보이면 유령 재생이 된다.
 * 실패로 그 곡에서 멈춰 둔 것(parked, ▶ 로 다시 여는 중 포함)은 소리가 없어도 곡을 보인다. 그래야 ▶ 를 누를 수 있다
 */
function soundAttached(player: Pick<Player, "audioPlayer"> & { parked?: boolean }) {
  if (player.parked) return true;
  const status = player.audioPlayer?.state?.status;
  return status !== undefined && status !== AudioPlayerStatus.Idle;
}

/** 소리를 내는가 · 멈췄는가 · 소리가 없는가(곡이 없거나 여는 중) */
function playState(player: Pick<Player, "audioPlayer" | "paused"> & { parked?: boolean }): "playing" | "paused" | "idle" {
  if (player.parked) return "paused";
  if (!soundAttached(player)) return "idle";
  const status = player.audioPlayer?.state?.status;
  return player.paused || status === AudioPlayerStatus.AutoPaused ? "paused" : "playing";
}

export { playbackStatus, playState, soundAttached };
