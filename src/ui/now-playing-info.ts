// /nowplaying 의 화면. 지금 곡의 필드(아티스트 · 앨범 · 플랫폼 · 진행 · 요청자 · 상태)을 모두 작은 글씨 줄로 보인다.
// 재생 패널과는 따로 그린다. 진행 막대만 패널과 같다

import { emojiOf, labelOf } from "../rules/platforms.ts";
import { frame } from "./frame.ts";
import { playbackStatus } from "./player-status.ts";
import { progressBar } from "./progress-bar.ts";
import * as infoText from "./text/ko/info.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import { songTitle } from "./text/ko/labels.ts";
import type { DiscordArt } from "./discord-art.ts";

/** art: 걸 그림(ui/discord-art 의 artFor, 첨부면 부르는 쪽이 그 파일을 함께 보낸다). 주지 않으면 곡 그림 주소 */
function nowPlayingView(player: Player, track: QueuedTrack, art?: DiscordArt | null) {
  const t = infoText.nowPlaying();
  // 길이를 모르는 곡(라이브 아님)은 진행을 뺀다
  const live = Boolean(player.isLive ?? track.isLive);
  const progress = live || track.duration > 0 ? progressBar(Math.floor(player.getCurrentTime() / 1000), track.duration || 0, { live }) : null;
  const platform = String(track.platform || "").toLowerCase();
  return frame({
    title: t.title,
    body: `**[${songTitle(track.title)}](${track.pageUrl})**`,
    thumbnail: art === undefined ? track.thumbnail : (art?.url ?? null),
    footer: [track.artist ? `${t.artist} ${track.artist}` : null, track.album ? `${t.album} ${track.album}` : null, `${t.platform} ${emojiOf(platform)} ${labelOf(platform)}`, progress ? `${t.progress} ${progress}` : null, track.requestedBy ? `${t.requester} <@${track.requestedBy.id}>` : null, `${t.status} ${infoText.nowPlayingStatus(playbackStatus(player))}`],
  });
}

export { nowPlayingView };
