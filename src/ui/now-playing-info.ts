// /nowplaying 의 화면. 맨 위 작은 글씨에 상태, 큰 제목(곡 링크) 아래 아티스트 · 앨범, 오른쪽에 곡 그림. 진행 막대는 화면 폭 전체로(패널과 같은 막대),
// 구분선 아래 작은 글씨로 볼륨 · 반복과 요청자 · 출처. 재생 패널과는 따로 그린다

import { ContainerBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, resolveColor } from "discord.js";
import { emojiOf, labelOf } from "../rules/platforms.ts";
import { colorOf } from "./colors.ts";
import * as discordArt from "./discord-art.ts";
import { escapeMd } from "./mentions.ts";
import { playbackStatus } from "./player-status.ts";
import { progressBar } from "./progress-bar.ts";
import * as infoText from "./text/ko/info.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import { songTitle } from "./text/ko/labels.ts";
import type { DiscordArt } from "./discord-art.ts";

/** art: 붙일 썸네일(ui/discord-art 의 artFor, 첨부면 부르는 쪽이 그 파일을 함께 보낸다). 주지 않으면 곡의 썸네일 주소 */
function nowPlayingView(player: Player, track: QueuedTrack, art?: DiscordArt | null) {
  const status = playbackStatus(player);
  // 제목은 이스케이프하지 않는다. 링크 라벨 안에서는 백슬래시가 그대로 보인다(ui/mentions)
  const byline = [track.artist, track.album].filter(Boolean).map(escapeMd).join(" · ");
  const head = [`-# ${infoText.nowPlayingState(status)}`, `## [${songTitle(track.title)}](${track.pageUrl})`, byline || null].filter(Boolean).join("\n");

  const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  const text = new TextDisplayBuilder().setContent(head);
  const thumbnail = discordArt.urlOf(art === undefined ? track.thumbnail : (art?.url ?? null));
  // 썸네일 없는 Section 은 보낼 때 거절된다
  if (thumbnail) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  else container.addTextDisplayComponents(text);

  // 길이를 모르는 곡(라이브 아님)은 진행을 뺀다
  const live = Boolean(player.isLive ?? track.isLive);
  if (live || track.duration > 0) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar(Math.floor(player.getCurrentTime() / 1000), track.duration || 0, { live })));

  const platform = String(track.platform || "").toLowerCase();
  const source = `${emojiOf(platform)} ${labelOf(platform)}`;
  const who = track.requestedBy?.id ? `${infoText.nowPlayingRequester(track.requestedBy.id)} • ${source}` : source;
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${infoText.nowPlayingSettings(status)}\n-# ${who}`));
  return container;
}

export { nowPlayingView };
