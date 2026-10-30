// /nowplaying 의 화면. 재생 패널과 같은 머리(현재 재생 중 · 곡 링크 · 아티스트와 앨범 · 곡 그림)에 진행 막대, 그 아래 작은 글씨 두 묶음:
// 이 곡(상태 · 요청 · 출처 · 음원)과 이어질 것(다음 곡 · 대기열 · 자동재생). 재생 패널과는 따로 그린다

import { ContainerBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, resolveColor } from "discord.js";
import * as genreConfig from "../config/genres.ts";
import { emojiOf, labelOf } from "../rules/platforms.ts";
import { colorOf } from "./colors.ts";
import * as discordArt from "./discord-art.ts";
import { formatDuration } from "./format.ts";
import { escapeMd } from "./mentions.ts";
import { playbackStatus } from "./player-status.ts";
import { progressBar } from "./progress-bar.ts";
import * as infoText from "./text/ko/info.ts";
import * as panelText from "./text/ko/panel.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import { songTitle } from "./text/ko/labels.ts";
import type { DiscordArt } from "./discord-art.ts";

const T = infoText.nowPlaying();
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** 음원 주소가 어느 곳의 것인지(링크 이름). 모르면 주소의 호스트 */
function audioHost(url: string) {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, "");
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return labelOf("youtube");
  if (/(^|\.)soundcloud\.com$/.test(host)) return labelOf("soundcloud");
  return host;
}

/** 이 곡: 상태(멈춘 까닭 포함) · 요청 · 출처 · 음원(요청 그대로가 아닐 때) */
function aboutTrack(player: Player, track: QueuedTrack) {
  const held = player.pause?.heldBy;
  const status = [infoText.nowPlayingStatus(playbackStatus(player)), held ? panelText.pausedStatus(held) : null].filter(Boolean).join(" • ");
  const platform = String(track.platform || "").toLowerCase();
  const requester = track.autoplay ? T.autoplayPick : track.requestedBy?.id ? `<@${track.requestedBy.id}>` : null;
  const audioUrl = track.audioUrl;
  const foundBy = audioUrl && track.audioFoundBy ? T.foundBy[track.audioFoundBy] : null;
  return [T.line("stats", T.status, status), requester ? T.line("person", T.requester, requester) : null, T.line("web", T.source, `${emojiOf(platform)} ${labelOf(platform)}`), audioUrl && foundBy ? T.line("link", T.audio, `[${audioHost(audioUrl)}](${audioUrl}) · ${foundBy}`) : null].filter(Boolean);
}

/** 다음 곡. 대기열이 비면 자동재생이 고르는지, 아니면 없음 */
function nextValue(player: Player) {
  const next = player.queue?.[0];
  if (!next) return player.autoplay ? T.nextByAutoplay : T.nextNone;
  return `[${songTitle(next.title)}](${next.pageUrl})${next.artist ? ` · ${escapeMd(next.artist)}` : ""}`;
}

/** 이어질 것: 다음 곡 · 대기열(곡 수 · 남은 길이) · 자동재생(켜져 있을 때만) */
function whatsNext(player: Player) {
  const queue = player.queue ?? [];
  const known = queue.reduce((sum, one) => sum + (one.duration || 0), 0);
  return [
    T.line("next", T.next, nextValue(player)),
    queue.length
      ? T.line(
          "queue",
          T.queue,
          T.queued(
            queue.length,
            formatDuration(known),
            queue.some((one) => !one.duration),
          ),
        )
      : null,
    player.autoplay ? T.line("autoplay", T.autoplay, T.autoplayOn(genreConfig.labelOf(player.autoplay))) : null,
  ].filter(Boolean);
}

/** art: 붙일 썸네일(ui/discord-art 의 artFor, 첨부면 부르는 쪽이 그 파일을 함께 보낸다). 주지 않으면 곡의 썸네일 주소 */
function nowPlayingView(player: Player, track: QueuedTrack, art?: DiscordArt | null) {
  // 제목은 이스케이프하지 않는다. 링크 라벨 안에서는 백슬래시가 그대로 보인다(ui/mentions)
  const byline = [track.artist ? `${T.artist} ${escapeMd(track.artist)}` : null, track.album ? `${T.album} ${escapeMd(track.album)}` : null].filter(Boolean).join(" · ");
  const head = [`### ${T.title}`, `**[${songTitle(track.title)}](${track.pageUrl})**`, byline ? `-# ${byline}` : null].filter(Boolean).join("\n");

  const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  const text = new TextDisplayBuilder().setContent(head);
  const thumbnail = discordArt.urlOf(art === undefined ? track.thumbnail : (art?.url ?? null));
  // 썸네일 없는 Section 은 보낼 때 거절된다
  if (thumbnail) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  else container.addTextDisplayComponents(text);

  // 길이를 모르는 곡(라이브 아님)은 진행을 뺀다
  const live = Boolean(player.isLive ?? track.isLive);
  if (live || track.duration > 0) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar(Math.floor(player.getCurrentTime() / 1000), track.duration || 0, { live })));

  container.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(aboutTrack(player, track).join("\n")));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(whatsNext(player).join("\n")));
  return container;
}

export { nowPlayingView };
