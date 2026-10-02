import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import { progressBar, emptyProgressBar } from "./progressBar.ts";
import { labelOf } from "../rules/platforms.ts";

/** 곡을 담은 결과를 알리는 매체(usecases/responders) */
type Responder = { notifyQueued(view: ContainerBuilder): Promise<unknown>; dismissPlaceholder(): Promise<unknown> };

// 알릴 곳이 없는 매체. 결과를 알리는 매체는 부르는 쪽(usecases/responders)이 넘긴다
const NO_RESPONDER: Responder = {
  async notifyQueued() {
    // 알릴 곳이 없다
  },
  async dismissPlaceholder() {
    // 치울 자리표시자가 없다
  },
};
import * as playerEvents from "../player/events.ts";
import * as panelText from "./text/ko/panel.ts";
import { addedView, type AdditionNotice } from "./addedNotice.ts";
import { frame, post } from "./frame.ts";
import { ALLOWED_MENTIONS, escapeMd } from "./mentions.ts";
import * as GuildSettingsManager from "../store/guildSettings.ts";
import * as trackState from "../player/trackState.ts";
import { codeOf, errorKind, messageOf } from "../rules/errorKind.ts";
import { repeatingFailure } from "../infra/repeatingFailure.ts";
import { canSend } from "./channels.ts";
import type { Client, Guild, GuildBasedChannel, GuildTextBasedChannel, Webhook, WebhookType } from "discord.js";
import type { Player, PanelMessage } from "../player/Player.ts";
import type { QueuedTrack } from "../player/track.ts";

// 편집 대상이 사라진 경우. 사용자가 메시지를 지웠거나 웹훅이 삭제됐다. 다시 올려야 한다.
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;
const isGone = (error: unknown) => codeOf(error) === UNKNOWN_MESSAGE || codeOf(error) === UNKNOWN_WEBHOOK;
// 패널을 올린 글자 채널이 지워졌다. 다시 올릴 곳이 없다
const UNKNOWN_CHANNEL = 10003;
// 디스코드 REST 가 제한 시간 안에 끝나지 않아 요청을 끊었다(우리는 REST 요청을 끊지 않는다). 다음 갱신이 다시 한다
const isRestTimeout = (error: unknown) => error instanceof Error && error.name === "AbortError";

// 패널 메시지가 있는 채널. 웹훅으로 올린 것은 API 모양이다
const channelIdOf = (message: PanelMessage) => ("channelId" in message ? message.channelId : message.channel_id);

/** 패널 내용. 채널 · 웹훅으로 보내고 고칠 때 같이 쓴다. 끝난 패널은 투명 썸네일을 붙이고, 재생 화면으로 되돌릴 때 뗀다 */
type Payload = {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  flags: MessageFlags.IsComponentsV2;
  files?: Array<ReturnType<typeof blankThumbnail.file>>;
  attachments?: [];
};
/** 끝난 패널의 문구 */
type IdleView = { reason: string; leavesAt?: number | null };
/** 조작 버튼을 그릴 때 읽는 칸. 끝난 패널은 플레이어 없이 그린다 */
type Controls = Pick<Player, "sessionId" | "previousTracks" | "queue" | "loop" | "paused" | "autoplay"> & Partial<Pick<Player, "sponsor">>;

// 전용 채널에서 "묻혔다"고 보기까지 기다리는 시간. 안내 메시지는 10초 뒤 스스로 지워지므로
// 그보다 길게 잡아 잠깐 나타났다 사라지는 것을 쫓아다니지 않는다(transientMessages.AUTO_DELETE_MS).
const PIN_SETTLE_MS = 12000;
import { markTransient, isTransient } from "./transientMessages.ts";
import { panelId, IDLE_SESSION } from "./customIds.ts";
import * as blankThumbnail from "./blankThumbnail.ts";
import { jumpDescription } from "./queueDisplay.ts";
import { PanelLocation, type PanelStore } from "./panelLocation.ts";
import { bestEffort } from "../infra/bestEffort.ts";
import { colorOf } from "./colors.ts";
import { isPublicUrl } from "../infra/publicAddress.ts";

// 끝난 패널의 버튼. 플레이어가 없어도 같은 모양을 그린다.
// 자동재생만 살아 있고, 그 버튼은 쉬는 중의 표식(idle)을 세션 자리에 달고 나간다.
const IDLE_CONTROLS: Controls = { sessionId: IDLE_SESSION, previousTracks: [], queue: [], loop: false, paused: false, autoplay: false };

// 반복 버튼의 모양
const LOOP_LOOKS = {
  track: { emoji: "🔂", style: ButtonStyle.Success },
  queue: { emoji: "🔁", style: ButtonStyle.Success },
  off: { emoji: "➡️", style: ButtonStyle.Secondary },
} as const;

// 한곡 반복 = 재시작이라 기록 없어도 활성
const canGoBack = (p: Controls) => p.previousTracks.length > 0 || p.loop === "track";
// 한곡 반복은 재시작, 자동재생은 다음 곡을 골라 대기열이 비어도 활성
const canSkip = (p: Controls) => p.queue.length > 0 || p.loop === "track" || Boolean(p.autoplay);
// 대기열 화면은 다음 곡만 보인다. 다음 곡이 없으면 대기열 버튼을 끈다
const queueOff = (p: Controls, disabled: boolean) => disabled || p.queue.length === 0;

// 상태 줄 (일시정지 / 대기열 수)
// 라이브 표식은 진행바의 경과 시간 자리에 있다(buildProgressBar). 여기서 또 내지 않는다.
function statusOf(player: Player) {
  const parts: string[] = [];
  if (player.paused) {
    if (player.pauseReasons?.has("mute")) parts.push(panelText.pausedStatus("mute"));
    else if (player.pauseReasons?.has("alone")) parts.push(panelText.pausedStatus("alone"));
    else parts.push(panelText.pausedStatus("other"));
  }
  if (player.queue.length > 0) {
    parts.push(panelText.queuedStatus(player.queue.length));
  }
  if (player.sponsor?.skipSegments?.length) {
    parts.push(panelText.segmentsStatus(player.sponsor.skipSegments.length));
  }
  return parts;
}

// 패널 아래의 대시보드 링크. DASHBOARD_URL 이 공개 주소일 때만(기본값 localhost 나 사설 주소는 다른 사람이 열 수 없다)
const dashboardLink = () => (isPublicUrl(config.dashboard.url) ? panelText.dashboardLink(config.dashboard.url) : null);

// 진행 막대를 고치는 간격. 앞 갱신이 끝난 뒤부터 잰다
const PROGRESS_MS = 5000;

// 끝난 패널 가운데 음성에 남아 기다리는 모양. 나갈 시각을 붙인다
const WAITING = new Set(["queue-end", "joined"]);

// 끝난 패널의 문구. 음성에 잠시 남을 때만 나갈 시각을 붙인다
function idleViewOf(reason: string): IdleView {
  const leaveMs = config.bot.leaveDelayQueueEmptyMs;
  return { reason, leavesAt: WAITING.has(reason) && leaveMs > 0 ? Date.now() + leaveMs : null };
}

class NowPlayingPanel {
  client: Client;
  progressTimers = new Map<string, NodeJS.Timeout>(); // guildId -> 다음 진행 막대 갱신
  webhookCache = new Map<string, WebhookClient>(); // channelId -> WebhookClient 매핑
  reposting = new Set<string>(); // 현재 재생 메시지를 다시 올리는 중인 guildId
  location: PanelLocation;
  idleViews = new Map<string, IdleView>(); // guildId → 끝난 패널의 문구 { reason, leavesAt }. 맨 아래로 다시 올릴 때 같은 모양으로
  repinTimers = new Map<string, NodeJS.Timeout>(); // guildId → 전용 채널 재고정 디바운스
  editFailures = new Map<string, ReturnType<typeof repeatingFailure>>(); // guildId → 잇단 갱신 실패(네트워크)

  // panelStore: 패널 자리 기록. 시험은 메모리 가짜를 준다
  constructor(client: Client, { panelStore }: { panelStore?: PanelStore } = {}) {
    this.client = client;
    this.location = new PanelLocation(this, panelStore);
  }

  deleteWebhookCache(channelId: string) {
    const webhookClient = this.webhookCache.get(channelId);
    if (webhookClient) {
      try {
        webhookClient.destroy();
      } catch {
        /* 버리는 웹훅이다. 다시 쓰지 않는다 */
      }
      this.webhookCache.delete(channelId);
    }
  }

  // 웹훅을 달 수 없는 채널(스레드 등)은 채널로 보낸다
  async getOrCreateWebhook(channel: GuildBasedChannel) {
    const cached = this.webhookCache.get(channel.id);
    if (cached) return cached;
    if (!("fetchWebhooks" in channel)) return null;
    try {
      const webhooks = await channel.fetchWebhooks();
      const ours = (wh: Webhook): wh is Webhook<WebhookType.Incoming> => wh.isIncoming() && wh.owner?.id === this.client.user?.id && wh.name === "Music Now Playing";
      let webhook = webhooks.find(ours);
      if (!webhook) {
        webhook = await channel.createWebhook({ name: "Music Now Playing" });
      }
      const client = new WebhookClient({ id: webhook.id, token: webhook.token }, { allowedMentions: ALLOWED_MENTIONS });
      this.webhookCache.set(channel.id, client);
      return client;
    } catch (error) {
      // 채널이 지워졌다. 그 채널로 보내는 쪽이 같은 오류를 받아 패널을 놓는다
      if (codeOf(error) !== UNKNOWN_CHANNEL) log.error("웹훅 조회/생성 실패:", messageOf(error));
      return null;
    }
  }

  /**
   * 첫 번째 트랙이 재생되는 동안 남은 재생목록 트랙이 추가되었음을 메시지로 표시
   */
  async showPlaylistAdditionMessage(player: Player, queued: QueuedTrack[], collection: string | null, insertFirst = false, notice: AdditionNotice = {}) {
    const view = addedView({ tracks: queued, collection, insertFirst, notice });

    // 진입점의 응답이 아니라 항상 텍스트 채널로. 채널이 없는 경로(대시보드)는 생략
    if (!player.textChannel || typeof player.textChannel.send !== "function") return;

    try {
      const infoMessage = await player.textChannel.send(post(view));
      markTransient(infoMessage?.id, 10000);

      // 10초 후 정보 메시지 삭제
      setTimeout(() => {
        infoMessage.delete().catch(() => {
          // 메시지가 이미 삭제되었을 수 있음
        });
      }, 10000);
    } catch (error) {
      log.error("재생목록 추가 안내 전송 실패:", error);
    }
  }

  /**
   * 새 음악 임베드 생성 (현재 재생 중인 곡이 없을 때)
   */
  async postPlaying(player: Player, track: QueuedTrack, responder: Responder = NO_RESPONDER, { reuse = true } = {}): Promise<{ success: true }> {
    if (player?.guild?.id) playerEvents.touched(player.guild.id); // 대시보드 SSE 넛지 (새로 틀기 시작함)
    const channel = await this._panelChannel(player);
    // 보낼 채널이 없으면 재생은 계속하되 임베드만 건너뛴다
    if (!canSend(channel)) {
      return { success: true };
    }

    this.idleViews.delete(player.guild.id);

    // 전용 채널 맨 아래의 끝난 패널은 그 자리를 재생 화면으로 고친다. 아니면 새로 올리고 지난 패널을 치운다.
    const reused = reuse ? await this._reuseIdlePanel(player, channel, track) : null;
    const { message, webhook } = reused ?? (await this._sendNowPlaying(player, track, channel));
    player.nowPlayingWebhook = webhook;
    if (!reused) await this.location.commit(player.guild, channel, message, webhook);

    // 진입점이 띄운 "검색 중…" 자리표시자 제거. 채널에 중복/정지 메시지를 남기지 않는다
    await responder.dismissPlaceholder();

    player.nowPlayingMessage = message;

    this.startProgressUpdate(player);

    return { success: true };
  }

  /**
   * 현재 재생 메시지를 채널에 보냅니다. 참조 갱신은 호출자 몫.
   *
   * 지속되는 now-playing 메시지는 상호작용 유무와 무관하게 항상 채널 웹훅(실패 시 일반 채널 메시지)으로 보낸다.
   * 상호작용 응답(@original)으로 보내면 이후 편집이 상호작용 토큰을 사용하는데, 이 토큰은 생성 15분 뒤 만료되어
   * 장시간 세션에서 진행바/트랙 갱신이 50027(Invalid Webhook Token)로 실패한다. 웹훅/봇 토큰은 만료되지 않는다.
   * (부수 효과로 메시지에 webhook_id가 붙어 CV2 이모지 링크 렌더링도 올바르게 유지된다.)
   */
  async _sendNowPlaying(player: Player, track: QueuedTrack, channel: GuildTextBasedChannel) {
    return this._sendPanel(channel, await this._playingPayload(player, track));
  }

  // 기억해 둔 웹훅이 디스코드에서 지워졌으면(10015: 봇이 서버를 나갔다 들어왔거나 누가 지웠다) 기억을 지우고 새로 만들어 한 번 더 보낸다
  async _sendPanel(channel: GuildTextBasedChannel, payload: Payload, retried = false): Promise<{ message: PanelMessage; webhook: WebhookClient | null }> {
    const webhook = await this.getOrCreateWebhook(channel);
    if (!webhook) return { message: await channel.send(payload), webhook: null };

    const me = this.client.user;
    try {
      const message = await webhook.send({
        ...payload,
        username: me?.displayName || me?.username,
        avatarURL: me?.displayAvatarURL(),
      });
      return { message, webhook };
    } catch (error) {
      if (retried || codeOf(error) !== UNKNOWN_WEBHOOK) throw error;
      this.deleteWebhookCache(channel.id);
      return this._sendPanel(channel, payload, true);
    }
  }

  async _playingPayload(player: Player, track: QueuedTrack): Promise<Payload> {
    const container = await this.createNowPlayingContainer(player, track);
    const jumpToRow = await this.createJumpToRow(player);
    return { components: jumpToRow ? [container, jumpToRow] : [container], flags: MessageFlags.IsComponentsV2 };
  }

  /** 이 서버의 전용 채널. 설정돼 있고 찾을 수 있을 때만 */
  async _dedicatedChannel(guild: Guild | null | undefined, fallback: GuildTextBasedChannel | null = null): Promise<GuildBasedChannel | null> {
    if (!guild?.id) return null;
    const id = await GuildSettingsManager.getBotChannel(guild.id);
    if (!id) return null;
    return guild.channels?.cache?.get(id) ?? (fallback?.id === id ? fallback : null);
  }

  /** 패널을 둘 채널. 전용 채널이 있으면 늘 거기, 없으면 요청한 채널 */
  async _panelChannel(player: Player) {
    return (await this._dedicatedChannel(player.guild, player.textChannel)) ?? player.textChannel;
  }

  // 전용 채널 맨 아래에 끝난 패널이 있으면 재생 화면으로 고친다. 고쳤으면 { message, webhook }
  async _reuseIdlePanel(player: Player, channel: GuildTextBasedChannel, track: QueuedTrack) {
    if ((await this._dedicatedChannel(player.guild, channel))?.id !== channel.id) return null;
    const record = await this.location.store.getPanel(player.guild.id);
    if (record?.channelId !== channel.id || this._buriedAt(channel, record.messageId)) return null;
    // 종료 모양이 붙여 둔 투명 썸네일 첨부를 뗀다
    const edited = await this.location.edit(player.guild, { ...(await this._playingPayload(player, track)), attachments: [] });
    return edited ? { message: { id: edited.messageId, channel_id: channel.id }, webhook: edited.webhook } : null;
  }

  /** 현재 재생 메시지를 지웁니다. 이미 없거나 권한이 없으면 그냥 넘어갑니다. */
  async _removeNowPlaying(channel: GuildTextBasedChannel, webhook: WebhookClient | null, messageId: string | undefined) {
    if (!messageId) return;
    try {
      if (webhook) await webhook.deleteMessage(messageId);
      else await channel.messages.delete(messageId);
    } catch {
      /* 이미 지워졌거나 지울 권한이 없음 */
    }
  }

  /**
   * 현재 재생 메시지를 채널 맨 아래에 다시 올립니다 (기존 것은 제거).
   * 사용자가 지웠을 때의 자가 복구와, 전용 채널에서 묻혔을 때의 재고정이 같은 경로를 씁니다.
   *
   * 서버당 한 번만. 5초 갱신과 명령·버튼 경로가 동시에 들어온다.
   * 보내는 사이에 재생이 끝나거나 다른 경로가 새 메시지를 올렸으면 방금 보낸 것을 도로 지운다.
   */
  async _repostNowPlaying(player: Player, reason: string) {
    const guildId = player.guild?.id;
    if (!guildId || this.reposting.has(guildId) || !player.currentTrack) return;

    this.reposting.add(guildId);
    const previous = player.nowPlayingMessage;
    try {
      const channel = await this._panelChannel(player);
      if (!canSend(channel)) return;
      const { message, webhook } = await this._sendNowPlaying(player, player.currentTrack, channel);

      if (player.nowPlayingMessage !== previous || !player.currentTrack) {
        await this._removeNowPlaying(channel, webhook, message?.id);
        return;
      }

      player.nowPlayingMessage = message;
      player.nowPlayingWebhook = webhook;
      await this.location.commit(player.guild, channel, message, webhook);
      log.info({ tags: ["recovered"] }, `재생 중 임베드 다시 올림: ${reason}`);
    } catch (error) {
      // 다시 올리지 못하면 참조를 버린다. 5초마다 같은 실패를 반복하면 그게 도배다
      if (codeOf(error) === UNKNOWN_CHANNEL) this._dropPanel(player);
      else {
        player.nowPlayingMessage = null;
        this.stopProgressUpdate(guildId);
        if (errorKind(error) === "network-error") log.warn(`재생 중 임베드 다시 올리기 실패: ${messageOf(error)}`);
        else log.error("재생 중 임베드 다시 올리기 실패:", messageOf(error));
      }
    } finally {
      this.reposting.delete(guildId);
    }
  }

  /**
   * 전용 채널에서 현재 재생 메시지가 다른 메시지 밑에 묻혔는지 봅니다.
   *
   * 채널 캐시만 읽는다(추가 API 호출 없음). 삭제된 메시지는 캐시에서도 빠지므로
   * 잠깐 떴다 사라지는 안내는 세는 대상이 아니다. 전용 채널이 아니면 건드리지 않는다.
   */
  async _isBuried(player: Player, now = Date.now()) {
    const channel = await this._dedicatedChannel(player.guild, player.textChannel);
    return channel ? this._buriedAt(channel, player.nowPlayingMessage?.id, now) : false;
  }

  // 채널 캐시만 읽는다. 12초 넘게 남은 메시지가 패널 아래에 있으면 묻힌 것
  _buriedAt(channel: GuildBasedChannel, messageId: string | undefined, now = Date.now()) {
    if (!messageId || !("messages" in channel) || !channel.messages?.cache) return false;

    const cutoff = now - PIN_SETTLE_MS;
    // 스스로 지워질 봇 메시지(더 넣기 메뉴 등)는 세지 않는다. 조작 중에 위치가 바뀌면 거슬린다
    return channel.messages.cache.some((m) => m.createdTimestamp <= cutoff && BigInt(m.id) > BigInt(messageId) && !isTransient(m.id, now));
  }

  /**
   * 현재 재생 컨테이너를 빌드합니다 (Components v2).
   */
  async createNowPlayingContainer(player: Player, track: QueuedTrack, buttonsDisabled = false) {
    const nowPlayingTitle = panelText.playingTitle();

    const currentMs = player.getCurrentTime ? player.getCurrentTime() : 0;
    const currentSec = Math.floor(currentMs / 1000);
    const totalSec = track.duration || 0;
    const bar = progressBar(currentSec, totalSec, { live: Boolean(player.isLive ?? track.isLive) });

    const artistValue = track.artist || "-";
    const platformValue = labelOf(track.platform);

    const artistLine = artistValue && artistValue !== "-" ? `\n-# 👤 ${escapeMd(artistValue)}` : "";
    // 제목은 이스케이프하지 않는다. 링크 라벨 안에서는 백슬래시가 그대로 노출된다(mentions.ts).
    // 보여 줄 링크(pageUrl)를 건다. 음원을 직접 트는 곡도 음원 파일이 아니라 출처 페이지다
    const linkText = `### ${nowPlayingTitle}\n**[${track.title}](${track.pageUrl})**${artistLine}`;

    // Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
    // 직접 링크는 썸네일이 없으므로(임의 URL이라 앨범아트를 알 수 없다) 텍스트만 넣는다.
    const titleComponent = track.thumbnail ? new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail)) : null;

    const statusParts = statusOf(player);

    const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
    if (titleComponent) container.addSectionComponents(titleComponent);
    else container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bar));

    if (statusParts.length > 0) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${statusParts.join(" • ")}`));
    }

    // 구분선 + 제어 버튼
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const buttons = await this.createControlButtons(player, buttonsDisabled);
    for (const row of buttons) {
      container.addActionRowComponents(row);
    }

    // 구분선 + 대시보드 링크(공개 주소일 때만) · 플랫폼
    const link = dashboardLink();
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${link ? `${link}  |  ` : ""}🖥️ ${platformValue}`));

    return container;
  }

  /**
   * 현재 재생 임베드를 제자리에서 갱신합니다.
   */
  async updatePlaying(player: Player) {
    if (player?.guild?.id) playerEvents.touched(player.guild.id); // 대시보드 SSE 넛지 (Discord 임베드 유무와 무관하게 발신)
    const panel = player.nowPlayingMessage;
    if (!panel || !player.currentTrack) return;
    if (this.reposting.has(player.guild.id)) return; // 다시 올리는 중. 그쪽이 최신 내용으로 보낸다

    try {
      const payload = await this._playingPayload(player, player.currentTrack);
      // 웹훅이 없으면 채널로 보낸 Message 다
      if (player.nowPlayingWebhook) await player.nowPlayingWebhook.editMessage(panel.id, payload);
      else if ("edit" in panel) await panel.edit(payload);
      this.editFailures.get(player.guild.id)?.ok();
    } catch (error) {
      await this._onEditFailed(player, error);
    }
  }

  // 패널 고치기가 실패했다. 까닭마다 할 일이 다르다
  async _onEditFailed(player: Player, error: unknown) {
    // 편집 대상이 없어졌다. 참조를 붙든 채 5초마다 같은 오류를 찍는 대신 다시 올린다
    if (isGone(error)) {
      if (codeOf(error) === UNKNOWN_WEBHOOK) {
        const channel = await this._panelChannel(player);
        if (channel?.id) this.deleteWebhookCache(channel.id);
        player.nowPlayingWebhook = null;
      }
      const channelId = player.nowPlayingMessage ? channelIdOf(player.nowPlayingMessage) : null;
      await this._repostNowPlaying(player, channelId && !player.guild.channels?.cache?.has(channelId) ? "패널이 있던 채널이 지워짐" : "메시지가 지워짐");
      return;
    }
    const where = player.guild.name ?? player.guild.id;
    if (codeOf(error) === UNKNOWN_CHANNEL) {
      this._dropPanel(player);
      return;
    }
    if (isRestTimeout(error)) {
      log.warn(`재생 중 임베드 갱신이 시간 안에 끝나지 않았습니다. 다음 갱신에서 다시 합니다 (${where})`);
      return;
    }
    // 네트워크가 끊겼다. 5초마다 같은 실패를 찍지 않고 처음 한 번과 풀린 때만
    if (errorKind(error) === "network-error") {
      this._editFailure(player).fail(messageOf(error));
      return;
    }
    log.error("재생 중 임베드 갱신 실패:", error);
  }

  _editFailure(player: Player) {
    const guildId = player.guild.id;
    let failure = this.editFailures.get(guildId);
    if (!failure) {
      failure = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, `재생 중 임베드 갱신(${player.guild.name ?? guildId})`);
      this.editFailures.set(guildId, failure);
    }
    return failure;
  }

  // 패널을 올린 글자 채널이 지워졌다. 다시 올릴 곳이 없어 패널을 놓는다
  _dropPanel(player: Player) {
    log.info(`패널을 올린 글자 채널이 사라져 패널을 놓습니다 (${player.guild.name ?? player.guild.id}). 재생은 이어집니다`);
    this.stopProgressUpdate(player.guild.id);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
    player.textChannel = null;
  }

  /**
   * 끝난 패널. 재생 화면과 같은 구조에 버튼만 끈다. 썸네일 자리는 투명 이미지로 채워 줄 구성을 맞춘다.
   * 곡 정보는 쓰지 않는다. 부르는 곳이 현재 곡을 먼저 비운다.
   * reason: queue-end(음성에 잠시 남음) | failures(곡이 연달아 실패해 멈춤. 대기열이 남으면 음성에 남는다) | stop · disconnected(나감) | leave(세션 저장됨) | joined(/join만 함)
   */
  async createIdleContainer({ reason = "stop", dedicated = false, leavesAt = null }: IdleView & { dedicated?: boolean } = { reason: "stop" }) {
    const heading = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(panelText.idle({ reason, leavesAt, dedicated }))).setThumbnailAccessory(new ThumbnailBuilder().setURL(blankThumbnail.url));

    const container = new ContainerBuilder()
      .setAccentColor(resolveColor(colorOf("brand")))
      .addSectionComponents(heading)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyProgressBar()))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    for (const row of await this.createControlButtons(IDLE_CONTROLS, true, { keepAutoplay: true })) container.addActionRowComponents(row);
    const link = dashboardLink();
    if (link) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${link}`));

    return { components: [container], files: [blankThumbnail.file()] };
  }

  /**
   * 재생이 끝났을 때. 패널을 종료 모양으로 바꾼다. 살아 있는 패널이 없으면 기록된 끝난 패널의 문구만 고친다
   * (대기 중에 음성에서 나감 등). 종료 메시지는 전용 채널 밖에서, 방금까지 재생하던 때만 올린다.
   */
  async drawEndedPanel(player: Player, { reason = "stop", cause }: { reason?: string; cause?: string } = {}) {
    const guild = player.guild;
    if (guild?.id) playerEvents.touched(guild.id); // 대시보드 SSE 넛지 (종료/정지)
    this.stopProgressUpdate(guild?.id);

    const live = player.nowPlayingMessage;
    const textChannel = player.textChannel;
    const dedicated = await this._panelIsDedicated(player, live);

    const view = idleViewOf(reason);
    if (guild?.id) this.idleViews.set(guild.id, view);
    await this._showIdle(player, live, { ...view, dedicated });

    // 전용 채널 밖의 패널은 대화에 밀려 어디까지 올라갔을지 모른다. 다 틀었거나 끊겼으면 따로 알린다.
    // 사람이 멈추거나 내보낸 것(/stop · /leave)은 명령 응답이, 연달아 실패는 채널 알림이 이미 말한다
    const ended = reason === "queue-end" ? panelText.ended() : cause ? panelText.cutOff(cause) : null;
    if (ended && live && !dedicated && canSend(textChannel)) await bestEffort(log, textChannel.send(post(frame({ title: ended.title, body: ended.body }))), "끝 안내 보내기");

    // 플레이어 정리
    trackState.setCurrent(player, null);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
  }

  // 패널이 전용 채널에 있나. 패널은 요청한 채널이 아니라 전용 채널에 있을 수 있다. textChannel로 판단하면 엉뚱한 채널에 종료 메시지가 간다
  async _panelIsDedicated(player: Player, live: PanelMessage | null) {
    const guildId = player.guild?.id;
    if (!guildId) return false;
    const panelChannelId = live ? (channelIdOf(live) ?? (await this._panelChannel(player))?.id) : (await this.location.store.getPanel(guildId))?.channelId;
    return Boolean(panelChannelId) && panelChannelId === (await GuildSettingsManager.getBotChannel(guildId));
  }

  // 패널을 종료 모양으로 바꾼다. 살아 있는 패널이 없으면 기록된 패널을 고친다
  async _showIdle(player: Player, live: PanelMessage | null, look: IdleView & { dedicated: boolean }) {
    try {
      const payload: Payload = { ...(await this.createIdleContainer(look)), flags: MessageFlags.IsComponentsV2 };
      if (live && player.nowPlayingWebhook) await player.nowPlayingWebhook.editMessage(live.id, payload);
      else if (live && "edit" in live) await live.edit(payload);
      else if (player.guild?.id) await this.location.edit(player.guild, payload);
    } catch (error) {
      // 이미 지워진 패널을 못 바꿨다는 것은 알릴 일이 아니다
      if (errorKind(error) === "network-error") log.warn(`패널을 종료 모양으로 바꾸지 못함: ${messageOf(error)}`);
      else if (!isGone(error)) log.error("패널을 종료 모양으로 바꾸지 못함:", error);
    }
  }

  /**
   * 곡이 없을 때 나갈 시각이 바뀌었다(혼자 남음 · 복귀). 음성에 남아 기다리는 끝난 패널만 고친다.
   * 재생 중이거나 이미 음성을 떠난 모양이면 할 일이 없다
   */
  async updateIdleLeave(player: Player, leavesAt: number | null) {
    const guildId = player.guild?.id;
    const view = guildId ? this.idleViews.get(guildId) : undefined;
    if (!guildId || !view || player.currentTrack || !WAITING.has(view.reason) || view.leavesAt === leavesAt) return;
    const next: IdleView = { ...view, leavesAt };
    this.idleViews.set(guildId, next);
    await this._showIdle(player, null, { ...next, dedicated: await this._panelIsDedicated(player, null) });
  }

  /** 전용 채널에 메시지가 올라오면 끝난 패널이 묻혔는지 잠시 뒤에 본다. 재생 중인 패널은 5초 갱신이 맡는다. */
  async scheduleIdleRepin(guild: Guild | null | undefined, channelId: string) {
    if (!guild?.id || (await GuildSettingsManager.getBotChannel(guild.id)) !== channelId) return;
    clearTimeout(this.repinTimers.get(guild.id));
    const timer = setTimeout(() => {
      this.repinTimers.delete(guild.id);
      this.repinIdlePanel(guild, channelId).catch((error) => log.warn(`끝난 패널을 맨 아래로 올리지 못함: ${messageOf(error)}`));
    }, PIN_SETTLE_MS + 1000);
    timer.unref?.();
    this.repinTimers.set(guild.id, timer);
  }

  async repinIdlePanel(guild: Guild, channelId: string, now = Date.now()) {
    const player = this.client.players.get(guild.id);
    if (player?.currentTrack && player.nowPlayingMessage) return;
    const channel = await this._dedicatedChannel(guild);
    if (!canSend(channel) || channel.id !== channelId) return;
    const record = await this.location.store.getPanel(guild.id);
    if (record?.channelId !== channel.id || !this._buriedAt(channel, record.messageId, now)) return;

    await this._postIdle(guild, channel);
  }

  // 끝난 패널을 이 채널 맨 아래에 올리고 이 서버의 패널로 삼는다
  async _postIdle(guild: Guild, channel: GuildTextBasedChannel, { dedicated = true } = {}) {
    const view: IdleView = this.idleViews.get(guild.id) ?? { reason: "stop" }; // 재시작 뒤라면 음성 밖이다
    const payload: Payload = { ...(await this.createIdleContainer({ ...view, dedicated })), flags: MessageFlags.IsComponentsV2 };
    const { message, webhook } = await this._sendPanel(channel, payload);
    await this.location.commit(guild, channel, message, webhook);
  }

  /** 전용 채널을 정했거나 바꿨거나 풀었을 때. 재생 중이면 패널을 옮기고, 아니면 끝난 패널을 새 채널에 올리거나 치운다 */
  async onBotChannelChanged(guild: Guild) {
    const channel = await this._dedicatedChannel(guild);
    const player = this.client.players.get(guild.id);
    if (player?.currentTrack && player.nowPlayingMessage) {
      if (channel) await this._repostNowPlaying(player, "전용 채널 변경");
      return; // 풀었으면 재생 중인 패널은 그 자리에 둔다. 끝나면 전용 채널 밖 규칙을 따른다
    }
    if (canSend(channel)) await this._postIdle(guild, channel);
    else await this.location.remove(guild);
  }

  /** 곡이 없을 때 /dashboard. 끝난 패널을 이 채널에 다시 올린다 */
  async repostIdlePanel(guild: Guild, channel: GuildTextBasedChannel) {
    const dedicated = (await this._dedicatedChannel(guild))?.id === channel.id;
    await this._postIdle(guild, channel, { dedicated });
  }

  /**
   * 기동 때 한 번. 기록된 패널을 지금 상태(음성 밖)로 고친다. 재생 중에 꺼졌으면 재생 모양과 살아 있는 버튼이 남아 있다.
   * 전용 채널에 패널이 없으면 올린다. 세션을 복원해 새 패널을 올린 서버는 건너뛴다.
   */
  async restorePanels() {
    for (const guild of this.client.guilds?.cache?.values() ?? []) {
      try {
        if (this.client.players.get(guild.id)?.nowPlayingMessage) continue;
        const channel = await this._dedicatedChannel(guild);
        const record = await this.location.store.getPanel(guild.id);
        if (record && (!channel || record.channelId === channel.id)) {
          const payload: Payload = { ...(await this.createIdleContainer({ reason: "stop", dedicated: Boolean(channel) })), flags: MessageFlags.IsComponentsV2 };
          if (await this.location.edit(guild, payload)) continue;
        }
        if (canSend(channel)) await this._postIdle(guild, channel);
      } catch (error) {
        log.warn(`패널 확인 실패 (${guild.name ?? guild.id}): ${messageOf(error)}`);
      }
    }
  }

  /**
   * 제어 버튼을 생성합니다.
   */
  // keepAutoplay: 나머지를 죽여도 자동재생만 살린다. 끝난 패널에서 다시 틀 수 있는 유일한 길이다.
  async createControlButtons(player: Controls, disabled = false, { keepAutoplay = false } = {}) {
    const id = (action: string) => panelId(action, player.sessionId);

    // Row 1: 이전곡 + 일시정지 + 스킵 + 정지 + 볼륨
    const previousButton = new ButtonBuilder()
      .setCustomId(id("previous"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏮️")
      .setDisabled(disabled || !canGoBack(player));

    const pauseButton = new ButtonBuilder()
      .setCustomId(id("pause"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setDisabled(disabled);

    const skipButton = new ButtonBuilder()
      .setCustomId(id("skip"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setDisabled(disabled || !canSkip(player));

    const stopButton = new ButtonBuilder().setCustomId(id("stop")).setStyle(ButtonStyle.Danger).setEmoji("⏹️").setDisabled(disabled);

    const volumeButton = new ButtonBuilder().setCustomId(id("volume")).setStyle(ButtonStyle.Secondary).setEmoji("🔊").setDisabled(disabled);

    // Row 2: 셔플(아이콘만) + 반복 + 대기열 + 자동재생
    const shuffleButton = new ButtonBuilder().setCustomId(id("shuffle")).setStyle(ButtonStyle.Secondary).setEmoji("🔀").setDisabled(disabled);

    // 반복 버튼. 꺼짐 → 트랙 → 대기열 순환
    const loopLook = LOOP_LOOKS[player.loop || "off"];
    const loopButton = new ButtonBuilder()
      .setCustomId(id("loop"))
      .setLabel(panelText.loopLabel(player.loop || "off"))
      .setStyle(loopLook.style)
      .setEmoji(loopLook.emoji)
      .setDisabled(disabled);

    const labels = panelText.buttons();
    const queueButton = new ButtonBuilder().setCustomId(id("queue")).setLabel(labels.queue).setStyle(ButtonStyle.Primary).setEmoji("📋").setDisabled(queueOff(player, disabled));

    const autoplayButton = new ButtonBuilder()
      .setCustomId(id("autoplay"))
      .setLabel(labels.autoplay)
      .setStyle(player.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🎲")
      .setDisabled(disabled && !keepAutoplay);

    // SponsorBlock 하이라이트 점프. 지점 없으면 비활성(스킵 버튼처럼 UI 일관성). 셔플 왼쪽. 봇 전체에서 SponsorBlock 을 껐으면 버튼을 두지 않는다
    const highlightAt = player.sponsor?.highlightAt;
    const hasHighlight = highlightAt !== null && highlightAt !== undefined;
    const highlightButton = new ButtonBuilder()
      .setCustomId(id("highlight"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💡")
      .setDisabled(disabled || !hasHighlight);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(previousButton, pauseButton, skipButton, stopButton, volumeButton);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(...(config.sponsorblock.enabled ? [highlightButton] : []), shuffleButton, loopButton, queueButton, autoplayButton);

    return [row, row2];
  }

  /**
   * 대기열 이동 선택 메뉴를 독립 ActionRow로 빌드합니다.
   * Discord가 Container 안에 중첩된 선택 메뉴 ActionRow를 무시하므로 최상위 components 배열에 배치해야 합니다 (Container 안이 아님).
   * 대기열이 비었거나 플레이어 상태가 없으면 null을 반환합니다.
   */
  async createJumpToRow(player: Pick<Player, "sessionId" | "queue">) {
    if (!player.sessionId || player.queue.length === 0) return null;

    const tracks = player.queue.slice(0, 25);
    const options = tracks.map((track, i) => {
      const label = `${i + 1}. ${track.title}`.slice(0, 100);
      const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i));
      const description = jumpDescription(track);
      if (description) opt.setDescription(description);
      return opt;
    });

    const placeholder = panelText.jumpPlaceholder();
    const select = new StringSelectMenuBuilder().setCustomId(panelId("jump", player.sessionId)).setPlaceholder(placeholder).addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * 진행 바를 새로고침하는 5초 간격 타이머를 시작합니다.
   */
  startProgressUpdate(player: Player) {
    const guildId = player.guild.id;
    this.stopProgressUpdate(guildId);
    // 앞 갱신이 끝난 뒤에 다음을 건다. 디스코드가 5초 넘게 걸려도 두 갱신이 겹치지 않는다
    const schedule = () => {
      const timer: NodeJS.Timeout = setTimeout(() => void this._progressTick(player, timer, schedule), PROGRESS_MS);
      this.progressTimers.set(guildId, timer);
    };
    schedule();
  }

  // 진행 막대 갱신 한 번과 다음 예약. 던지지 않는다
  async _progressTick(player: Player, timer: NodeJS.Timeout, schedule: () => void) {
    const guildId = player.guild.id;
    if (!player.currentTrack || !player.nowPlayingMessage) {
      this.stopProgressUpdate(guildId);
      return;
    }
    try {
      await this._tickProgress(player);
    } catch (error) {
      // 고치기 실패는 _onEditFailed 가 가른다. 여기까지 온 것은 모르는 오류라 남기고 이 곡의 갱신을 멈춘다(5초마다 같은 줄을 찍지 않게)
      log.error(`진행 막대 갱신이 던져 이 곡의 갱신을 멈춤 (${player.guild.name ?? guildId}):`, error);
      this.stopProgressUpdate(guildId);
      return;
    }
    // 갱신하는 동안 멈췄거나 새로 걸었으면 잇지 않는다(걸려 있던 것은 stopProgressUpdate 가 지운다)
    if (this.progressTimers.get(guildId) === timer) schedule();
  }

  // 진행 막대 한 번. 전용 채널에서 묻혔으면 맨 아래로 다시 올린다
  async _tickProgress(player: Player) {
    if (await this._isBuried(player)) await this._repostNowPlaying(player, "전용 채널 맨 아래로");
    else await this.updatePlaying(player);
  }

  /**
   * 서버의 진행 갱신 타이머를 중지합니다.
   */
  stopProgressUpdate(guildId: string | undefined) {
    if (!guildId) return;
    const timer = this.progressTimers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.progressTimers.delete(guildId);
    }
    this.editFailures.delete(guildId);
  }
}

export { NowPlayingPanel };
export type { Responder };
