// /nowplaying 의 화면. 지금 곡의 칸(아티스트 · 앨범 · 플랫폼 · 진행 · 요청자 · 상태)을 모두 작은 글씨 줄로 보인다.
// 재생 패널과는 따로 그린다(2026-10-02 사용자). 진행 막대만 패널과 같다

import { emojiOf, labelOf } from "../rules/platforms.ts";
import { frame } from "./frame.ts";
import { playbackStatus } from "./playerStatus.ts";
import { progressBar } from "./progressBar.ts";
import * as infoText from "./text/ko/info.ts";
import type { Player } from "../player/Player.ts";
import type { QueuedTrack } from "../player/track.ts";

function nowPlayingView(player: Player, track: QueuedTrack) {
  const t = infoText.nowPlaying();
  // 길이를 모르는 곡(라이브 아님)은 진행을 뺀다
  const live = Boolean(player.isLive ?? track.isLive);
  const progress = live || track.duration > 0 ? progressBar(Math.floor(player.getCurrentTime() / 1000), track.duration || 0, { live }) : null;
  const platform = String(track.platform || "").toLowerCase();
  return frame({
    title: t.title,
    body: `**[${track.title}](${track.pageUrl})**`,
    thumbnail: track.thumbnail,
    footer: [track.artist ? `${t.artist} ${track.artist}` : null, track.album ? `${t.album} ${track.album}` : null, `${t.platform} ${emojiOf(platform)} ${labelOf(platform)}`, progress ? `${t.progress} ${progress}` : null, track.requestedBy ? `${t.requester} <@${track.requestedBy.id}>` : null, `${t.status} ${infoText.nowPlayingStatus(playbackStatus(player))}`],
  });
}

export { nowPlayingView };
