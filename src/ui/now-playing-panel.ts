import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient, PermissionFlagsBits } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../config/index.ts";
import { progressBar, emptyProgressBar } from "./progress-bar.ts";
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
import { buttonEmoji, icon, type IconKey } from "./icons.ts";
import { addedView, type AdditionNotice } from "./added-notice.ts";
import { frame, post } from "./frame.ts";
import { ALLOWED_MENTIONS, escapeMd } from "./mentions.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import * as trackState from "../player/track-state.ts";
import { codeOf, errorKind, messageOf } from "../rules/error-kind.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { canPost, canPostPanel } from "./channels.ts";
import type { Client, Guild, GuildBasedChannel, GuildTextBasedChannel, Webhook, WebhookType } from "discord.js";
import type { Player, PanelMessage } from "../player/player.ts";
import type { PlayerSeats } from "../player/registry.ts";
import type { QueuedTrack } from "../player/track.ts";

// 편집 대상이 사라진 경우. 사용자가 메시지를 삭제했거나 웹훅이 삭제됐다. 다시 올려야 한다.
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;
const isGone = (error: unknown) => codeOf(error) === UNKNOWN_MESSAGE || codeOf(error) === UNKNOWN_WEBHOOK;
// 패널을 올린 텍스트 채널이 삭제됐다. 다시 올릴 곳이 없다
const UNKNOWN_CHANNEL = 10003;
// 디스코드 REST 가 제한 시간 안에 끝나지 않아 요청을 끊었다(우리는 REST 요청을 끊지 않는다). 다음 갱신이 다시 한다
const isRestTimeout = (error: unknown) => error instanceof Error && error.name === "AbortError";

// 패널 메시지가 있는 채널. 웹훅으로 올린 것은 API 모양이다
const channelIdOf = (message: PanelMessage) => ("channelId" in message ? message.channelId : message.channel_id);

/**
 * 패널 내용. 채널 · 웹훅으로 보내고 고칠 때 같이 쓴다. 끝난 패널은 투명 썸네일을, 그림이 없는 곡은 음표 썸네일을 첨부한다.
 * attachments: [] 는 붙어 있던 첨부를 떼고 files 만 남긴다(고칠 때 첨부를 보내지 않으면 붙어 있던 것이 그대로 남는다)
 */
type Payload = {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  flags: MessageFlags.IsComponentsV2;
  files?: Array<{ attachment: Buffer; name: string }>;
  attachments?: [];
};
/** 끝난 패널의 문구 */
type IdleView = { reason: string; leavesAt?: number | null };
/** 조작 버튼을 그릴 때 읽는 필드. 끝난 패널은 플레이어 없이 그린다 */
type Controls = Pick<Player, "sessionId" | "previousTracks" | "queue" | "loop" | "paused" | "autoplay"> & Partial<Pick<Player, "sponsor">>;

// 전용 채널에서 "묻혔다"고 보기까지 기다리는 시간. 안내 메시지는 10초 뒤 스스로 삭제되므로
// 그보다 길게 잡아 잠깐 나타났다 사라지는 것을 쫓아다니지 않는다(transientMessages.AUTO_DELETE_MS).
const PIN_SETTLE_MS = 12000;
/** 패널에 붙여 둔 썸네일이 음표(그림 없는 곡)라는 표시. 그 밖은 파일 태그 그림의 지문 */
const NO_ART = "no-art";
import { isTransient, scheduleDelete } from "./transient-messages.ts";
import { LIFETIME } from "./delivery.ts";
import { panelId, IDLE_SESSION } from "./custom-ids.ts";
import * as blankThumbnail from "./blank-thumbnail.ts";
import * as noArtThumbnail from "./no-art-thumbnail.ts";
import * as discordArt from "./discord-art.ts";
import { jumpDescription } from "./queue-display.ts";
import { PanelLocation, type PanelStore } from "./panel-location.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { colorOf } from "./colors.ts";
import { isPublicUrl } from "../infra/public-address.ts";
import { songTitle } from "./text/ko/labels.ts";
import { SELECT_MAX } from "../rules/limits.ts";
import { canGoBack, canGoNext } from "../rules/controls.ts";

// 끝난 패널의 버튼. 플레이어가 없어도 같은 모양을 그린다.
// 자동재생만 살아 있고, 그 버튼은 쉬는 중의 표식(idle)을 세션 필드에 달고 나간다.
const IDLE_CONTROLS: Controls = { sessionId: IDLE_SESSION, previousTracks: [], queue: [], loop: false, paused: false, autoplay: false };

// 반복 버튼의 모양. 아이콘은 표의 키(그릴 때 앱 이모지로), 색 버튼 위는 흰 기호
const LOOP_LOOKS = {
  track: { icon: "repeat_one_on", style: ButtonStyle.Success },
  queue: { icon: "repeat_on", style: ButtonStyle.Success },
  off: { icon: "repeat_off", style: ButtonStyle.Secondary },
} as const satisfies Record<string, { icon: IconKey; style: ButtonStyle }>;
// 자동재생 버튼의 모양(켜짐 · 꺼짐)
const AUTOPLAY_LOOKS = {
  on: { icon: "autoplay_on", style: ButtonStyle.Success },
  off: { icon: "autoplay", style: ButtonStyle.Secondary },
} as const satisfies Record<string, { icon: IconKey; style: ButtonStyle }>;

// 이전 · 다음 곡 버튼을 켤지(대시보드와 같은 규칙, rules/controls)
const canBack = (p: Controls) => canGoBack({ history: p.previousTracks.length, loop: p.loop });
const canSkip = (p: Controls) => canGoNext({ queue: p.queue.length, loop: p.loop, autoplay: p.autoplay });
// 대기열 화면은 다음 곡만 보인다. 다음 곡이 없으면 대기열 버튼을 끈다
const queueOff = (p: Controls, disabled: boolean) => disabled || p.queue.length === 0;

// 상태 줄: 일시정지 · 대기열 수 등. 라이브 표식은 진행바의 경과 시간 위치에 있다(buildProgressBar). 여기서 또 내지 않는다.
function statusOf(player: Player) {
  const parts: string[] = [];
  if (player.paused) {
    if (player.pauseReasons?.has("mute")) parts.push(panelText.pausedStatus("mute"));
    else if (player.pauseReasons?.has("stage")) parts.push(panelText.pausedStatus("stage"));
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
  players: Pick<PlayerSeats, "get">; // 서버마다의 플레이어. 패널이 지금 재생 중인지 본다
  progressTimers = new Map<string, NodeJS.Timeout>(); // guildId -> 다음 진행 막대 갱신
  webhookCache = new Map<string, WebhookClient>(); // channelId -> 그 채널에 패널을 올리는 웹훅
  reposting = new Set<string>(); // 현재 재생 메시지를 다시 올리는 중인 guildId
  location: PanelLocation;
  idleViews = new Map<string, IdleView>(); // guildId → 끝난 패널의 문구 { reason, leavesAt }. 맨 아래로 다시 올릴 때 같은 모양으로
  repinTimers = new Map<string, NodeJS.Timeout>(); // guildId → 전용 채널 재고정 디바운스
  editFailures = new Map<string, ReturnType<typeof repeatingFailure>>(); // guildId → 잇단 갱신 실패(네트워크)
  attachedArt = new Map<string, string>(); // guildId → 지금 패널 메시지에 첨부해 둔 썸네일("no-art" 음표 · 파일 태그 그림의 지문)

  // panelStore: 패널 위치 기록. 테스트는 메모리 가짜를 준다
  constructor(client: Client, players: Pick<PlayerSeats, "get">, { panelStore }: { panelStore?: PanelStore } = {}) {
    this.client = client;
    this.players = players;
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

  // 웹훅을 달 수 없는 채널(스레드 등)이나 웹훅 관리 권한이 없는 채널은 채널로 보낸다
  async getOrCreateWebhook(channel: GuildBasedChannel) {
    const cached = this.webhookCache.get(channel.id);
    if (cached) return cached;
    if (!("fetchWebhooks" in channel)) return null;
    const me = channel.guild.members.me;
    if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) return null;
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
      // 채널이 삭제됐다. 그 채널로 보내는 쪽이 같은 오류를 받아 패널을 놓는다
      // 권한 없음은 서버가 그 채널에서 막은 것이다(채널로 보낸다)
      if (errorKind(error).startsWith("permission-")) log.debug("웹훅 조회/생성 거절:", messageOf(error));
      else if (codeOf(error) !== UNKNOWN_CHANNEL) log.error("웹훅 조회/생성 실패:", messageOf(error));
      return null;
    }
  }

  /** 재생목록을 넣어 첫 곡이 시작된 뒤 남은 곡을 담았다고 알린다. 잠깐 보이고 삭제한다 */
  async showPlaylistAdditionMessage(player: Player, queued: QueuedTrack[], collection: string | null, insertFirst = false, notice: AdditionNotice = {}) {
    const view = addedView({ tracks: queued, collection, insertFirst, notice });

    // 진입점의 응답이 아니라 항상 텍스트 채널로. 채널이 없는 경로(대시보드)는 생략
    if (!canPost(player.textChannel)) return;

    try {
      scheduleDelete(await player.textChannel.send(post(view)), LIFETIME.glance);
    } catch (error) {
      log.error("재생목록 추가 안내 전송 실패:", error);
    }
  }

  /** 새 곡을 틀기 시작할 때 재생 패널을 올린다(전용 채널 맨 아래의 끝난 패널은 고쳐 쓴다) */
  async postPlaying(player: Player, track: QueuedTrack, responder: Responder = NO_RESPONDER, { reuse = true } = {}): Promise<{ success: true }> {
    if (player?.guild?.id) playerEvents.touched(player.guild.id); // 대시보드 SSE 넛지 (새로 틀기 시작함)
    const channel = await this.panelChannel(player);
    // 보낼 채널이 없으면 재생은 계속하되 임베드만 건너뛴다
    if (!canPostPanel(channel)) {
      return { success: true };
    }

    this.idleViews.delete(player.guild.id);

    // 전용 채널 맨 아래의 끝난 패널은 그 패널을 재생 화면으로 고친다. 아니면 새로 올리고 지난 패널을 치운다.
    const reused = reuse ? await this._reuseIdlePanel(player, channel, track) : null;
    const { message, webhook } = reused ?? (await this._sendNowPlaying(player, track, channel));
    player.nowPlayingWebhook = webhook;
    if (!reused) await this.location.commit(player.guild, channel, message, webhook);

    // 진입점이 표시한 "검색 중…" 자리표시자 제거. 채널에 중복/정지 메시지를 남기지 않는다
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
    return this._sendPanel(channel, await this._playingPayload(player, track, true));
  }

  // 기억해 둔 웹훅이 디스코드에서 삭제됐으면(10015: 봇이 서버를 나갔다 들어왔거나 누가 삭제했다) 기억을 지우고 새로 만들어 한 번 더 보낸다
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

  /**
   * 재생 중 패널 내용. 첨부하는 썸네일(그림이 없는 곡의 음표 · 직접 링크 곡의 파일 태그 그림)은 바뀔 때만 올린다(5초 갱신마다 다시 올리지 않는다):
   * 새로 올리는 패널(fresh) · 붙어 있는 것과 다르면 올리고, 주소로 거는 그림인 곡으로 바뀌면 뗀다
   */
  async _playingPayload(player: Player, track: QueuedTrack, fresh = false): Promise<Payload> {
    const art = await discordArt.artFor(track);
    const container = await this.createNowPlayingContainer(player, track, false, art);
    const jumpToRow = await this.createJumpToRow(player);
    const payload: Payload = { components: jumpToRow ? [container, jumpToRow] : [container], flags: MessageFlags.IsComponentsV2 };
    const guildId = player.guild?.id ?? "";
    const attached = fresh ? undefined : this.attachedArt.get(guildId);
    const wanted = art?.file ? art.fingerprint : art ? null : NO_ART;
    if (wanted === null) {
      if (attached) payload.attachments = [];
      this.attachedArt.delete(guildId);
    } else if (wanted !== attached) {
      payload.files = [art?.file ?? (await noArtThumbnail.file(colorOf("brand")))];
      payload.attachments = [];
      this.attachedArt.set(guildId, wanted ?? NO_ART);
    }
    return payload;
  }

  /** 이 서버의 전용 채널. 설정돼 있고 찾을 수 있을 때만 */
  async _dedicatedChannel(guild: Guild | null | undefined, fallback: GuildTextBasedChannel | null = null): Promise<GuildBasedChannel | null> {
    if (!guild?.id) return null;
    const id = await GuildSettingsManager.getBotChannel(guild.id);
    if (!id) return null;
    return guild.channels?.cache?.get(id) ?? (fallback?.id === id ? fallback : null);
  }

  /** 패널을 둘 채널. 전용 채널이 있으면 거기, 없거나 봇이 그 채널에 글을 올릴 수 없으면 요청한 채널 */
  async panelChannel(player: Player) {
    const dedicated = await this._dedicatedChannel(player.guild, player.textChannel);
    return canPostPanel(dedicated) ? dedicated : player.textChannel;
  }

  // 전용 채널 맨 아래에 끝난 패널이 있으면 재생 화면으로 고친다. 고쳤으면 { message, webhook }
  async _reuseIdlePanel(player: Player, channel: GuildTextBasedChannel, track: QueuedTrack) {
    if ((await this._dedicatedChannel(player.guild, channel))?.id !== channel.id) return null;
    const record = await this.location.store.getPanel(player.guild.id);
    if (record?.channelId !== channel.id || this._buriedAt(channel, record.messageId)) return null;
    // 종료 모양이 붙여 둔 투명 썸네일 첨부를 뗀다
    const edited = await this.location.edit(player.guild, { ...(await this._playingPayload(player, track, true)), attachments: [] });
    return edited ? { message: edited.message ?? { id: edited.messageId, channel_id: channel.id }, webhook: edited.webhook } : null;
  }

  /** 현재 재생 메시지를 삭제합니다. 이미 없거나 권한이 없으면 그냥 넘어갑니다. */
  async _removeNowPlaying(channel: GuildTextBasedChannel, webhook: WebhookClient | null, messageId: string | undefined) {
    if (!messageId) return;
    try {
      if (webhook) await webhook.deleteMessage(messageId);
      else await channel.messages.delete(messageId);
    } catch {
      /* 이미 삭제됐거나 삭제할 권한이 없음 */
    }
  }

  /**
   * 현재 재생 메시지를 채널 맨 아래에 다시 올립니다 (기존 것은 제거).
   * 사용자가 삭제했을 때의 자가 복구와, 전용 채널에서 묻혔을 때의 재고정이 같은 경로를 씁니다.
   *
   * 서버당 한 번만. 5초 갱신과 명령·버튼 경로가 동시에 들어온다.
   * 보내는 사이에 재생이 끝나거나 다른 경로가 새 메시지를 올렸으면 방금 보낸 것을 도로 삭제한다.
   */
  async _repostNowPlaying(player: Player, reason: string) {
    const guildId = player.guild?.id;
    if (!guildId || this.reposting.has(guildId) || !player.currentTrack) return;

    this.reposting.add(guildId);
    const previous = player.nowPlayingMessage;
    try {
      const channel = await this.panelChannel(player);
      if (!canPostPanel(channel)) return;
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
    // 패널을 전용 채널에 둘 때만(올릴 수 없으면 패널은 요청한 채널에 있다. panelChannel)
    const channel = await this._dedicatedChannel(player.guild, player.textChannel);
    return canPostPanel(channel) ? this._buriedAt(channel, player.nowPlayingMessage?.id, now) : false;
  }

  // 채널 캐시만 읽는다. 12초 넘게 남은 메시지가 패널 아래에 있으면 묻힌 것
  _buriedAt(channel: GuildBasedChannel, messageId: string | undefined, now = Date.now()) {
    if (!messageId || !("messages" in channel) || !channel.messages?.cache) return false;

    const cutoff = now - PIN_SETTLE_MS;
    // 스스로 삭제될 봇 메시지(더 넣기 메뉴 등)는 세지 않는다. 조작 중에 위치가 바뀌면 거슬린다
    return channel.messages.cache.some((m) => m.createdTimestamp <= cutoff && BigInt(m.id) > BigInt(messageId) && !isTransient(m.id, now));
  }

  /** 재생 중 패널의 화면(Components V2). art: 걸 그림(ui/discord-art, 주지 않으면 여기서 묻는다) */
  async createNowPlayingContainer(player: Player, track: QueuedTrack, buttonsDisabled = false, art?: discordArt.DiscordArt | null) {
    const nowPlayingTitle = panelText.playingTitle();

    const currentMs = player.getCurrentTime ? player.getCurrentTime() : 0;
    const currentSec = Math.floor(currentMs / 1000);
    const totalSec = track.duration || 0;
    const bar = progressBar(currentSec, totalSec, { live: Boolean(player.isLive ?? track.isLive) });

    const artistValue = track.artist || "-";
    const platformValue = labelOf(track.platform);

    const artistLine = artistValue && artistValue !== "-" ? `\n-# ${icon("person")} ${escapeMd(artistValue)}` : "";
    // 제목은 이스케이프하지 않는다. 링크 라벨 안에서는 백슬래시가 그대로 노출된다(mentions.ts).
    // 보여 줄 링크(pageUrl)를 건다. 음원을 직접 트는 곡도 음원 파일이 아니라 출처 페이지다
    const linkText = `### ${nowPlayingTitle}\n**[${songTitle(track.title)}](${track.pageUrl})**${artistLine}`;

    // Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다. 그림이 없는 곡은 음표 썸네일(_playingPayload 가 첨부한다).
    // 디스코드는 눌러서 크게 보여 주므로 큰 그림을 건다(곡 그림 주소의 큰 것, 직접 링크 곡은 첨부한 파일 태그 그림)
    const shown = art === undefined ? await discordArt.artFor(track) : art;
    const titleComponent = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(shown?.url ?? noArtThumbnail.url));

    const statusParts = statusOf(player);

    const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
    container.addSectionComponents(titleComponent);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bar));

    if (statusParts.length > 0) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${statusParts.join(" • ")}`));
    }

    // 구분선 뒤에 조작 버튼
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const buttons = await this.createControlButtons(player, buttonsDisabled);
    for (const row of buttons) {
      container.addActionRowComponents(row);
    }

    // 구분선 + 대시보드 링크(공개 주소일 때만) · 플랫폼
    const link = dashboardLink();
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${link ? `${link}  |  ` : ""}${icon("system")} ${platformValue}`));

    return container;
  }

  /** 재생 중 패널을 제자리에서 다시 그린다 */
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
      // 첨부가 실렸는지 모르니 다음에 다시 올린다
      this.attachedArt.delete(player.guild.id);
      await this._onEditFailed(player, error);
    }
  }

  // 패널 고치기가 실패했다. 까닭마다 할 일이 다르다
  async _onEditFailed(player: Player, error: unknown) {
    // 편집 대상이 없어졌다. 참조를 붙든 채 5초마다 같은 오류를 찍는 대신 다시 올린다
    if (isGone(error)) {
      if (codeOf(error) === UNKNOWN_WEBHOOK) {
        const channel = await this.panelChannel(player);
        if (channel?.id) this.deleteWebhookCache(channel.id);
        player.nowPlayingWebhook = null;
      }
      const channelId = player.nowPlayingMessage ? channelIdOf(player.nowPlayingMessage) : null;
      await this._repostNowPlaying(player, channelId && !player.guild.channels?.cache?.has(channelId) ? "패널이 있던 채널이 삭제됨" : "메시지가 삭제됨");
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
    // 네트워크가 끊겼거나 그 채널의 권한이 빠졌다(서버가 막았다). 5초마다 같은 실패를 찍지 않고 처음 한 번과 풀린 때만
    const kind = errorKind(error);
    if (kind === "network-error" || kind.startsWith("permission-")) {
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

  // 패널을 올린 텍스트 채널이 삭제됐다. 다시 올릴 곳이 없어 패널을 놓는다
  _dropPanel(player: Player) {
    log.info(`패널을 올린 텍스트 채널이 사라져 패널을 놓습니다 (${player.guild.name ?? player.guild.id}). 재생은 이어집니다`);
    this.stopProgressUpdate(player.guild.id);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
    player.textChannel = null;
  }

  /**
   * 끝난 패널. 재생 화면과 같은 구조에 버튼만 끈다. 썸네일 슬롯은 투명 이미지로 채워 줄 구성을 맞춘다.
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

    // 붙어 있던 첨부(그림 없는 곡의 음표 썸네일)는 떼고 투명 썸네일만
    return { components: [container], files: [blankThumbnail.file()], attachments: [] as [] };
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
    if (ended && live && !dedicated && canPost(textChannel)) await bestEffort(log, textChannel.send(post(frame({ icon: ended.icon, title: ended.title, body: ended.body }))), "끝 안내 보내기");

    // 플레이어는 이제 틀고 있는 곡 · 패널이 없다
    trackState.setCurrent(player, null);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
  }

  // 패널이 전용 채널에 있나. 패널은 요청한 채널이 아니라 전용 채널에 있을 수 있다. textChannel로 판단하면 엉뚱한 채널에 종료 메시지가 간다
  async _panelIsDedicated(player: Player, live: PanelMessage | null) {
    const guildId = player.guild?.id;
    if (!guildId) return false;
    const panelChannelId = live ? (channelIdOf(live) ?? (await this.panelChannel(player))?.id) : (await this.location.store.getPanel(guildId))?.channelId;
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
      // 이미 삭제된 패널을 못 바꿨다는 것은 알릴 일이 아니다
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
    const player = this.players.get(guild.id);
    if (player?.currentTrack && player.nowPlayingMessage) return;
    const channel = await this._dedicatedChannel(guild);
    if (!canPostPanel(channel) || channel.id !== channelId) return;
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
    const player = this.players.get(guild.id);
    if (player?.currentTrack && player.nowPlayingMessage) {
      if (channel) await this._repostNowPlaying(player, "전용 채널 변경");
      return; // 풀었으면 재생 중인 패널은 그 자리에 둔다. 끝나면 전용 채널 밖 규칙을 따른다
    }
    if (canPostPanel(channel)) await this._postIdle(guild, channel);
    else await this.location.remove(guild);
  }

  /** 곡이 없을 때 /dashboard. 끝난 패널을 이 채널에 다시 올린다 */
  async repostIdlePanel(guild: Guild, channel: GuildTextBasedChannel) {
    const dedicated = (await this._dedicatedChannel(guild))?.id === channel.id;
    await this._postIdle(guild, channel, { dedicated });
  }

  /**
   * 아이콘(앱 이모지)이 바뀌었을 때. 재생 중인 패널은 5초 갱신이 새 아이콘으로 다시 그리므로 끝난 패널만,
   * 같은 모양으로 그 자리에서 고친다(새로 올리지 않는다)
   */
  async redrawIdlePanels() {
    for (const guild of this.client.guilds?.cache?.values() ?? []) {
      try {
        if (this.players.get(guild.id)?.nowPlayingMessage) continue;
        const record = await this.location.store.getPanel(guild.id);
        if (!record) continue;
        const view: IdleView = this.idleViews.get(guild.id) ?? { reason: "stop" };
        const dedicated = record.channelId === (await GuildSettingsManager.getBotChannel(guild.id));
        const payload: Payload = { ...(await this.createIdleContainer({ ...view, dedicated })), flags: MessageFlags.IsComponentsV2 };
        await this.location.edit(guild, payload);
      } catch (error) {
        log.warn(`끝난 패널을 다시 그리지 못함 (${guild.name ?? guild.id}): ${messageOf(error)}`);
      }
    }
  }

  /**
   * 시작할 때 한 번. 기록된 패널을 지금 상태(음성 밖)로 고친다. 재생 중에 꺼졌으면 재생 모양과 살아 있는 버튼이 남아 있다.
   * 전용 채널에 패널이 없으면 올린다. 세션을 복원해 새 패널을 올린 서버는 건너뛴다.
   */
  async restorePanels() {
    for (const guild of this.client.guilds?.cache?.values() ?? []) {
      try {
        if (this.players.get(guild.id)?.nowPlayingMessage) continue;
        const channel = await this._dedicatedChannel(guild);
        const record = await this.location.store.getPanel(guild.id);
        if (record && (!channel || record.channelId === channel.id)) {
          const payload: Payload = { ...(await this.createIdleContainer({ reason: "stop", dedicated: Boolean(channel) })), flags: MessageFlags.IsComponentsV2 };
          if (await this.location.edit(guild, payload)) continue;
        }
        if (canPostPanel(channel)) await this._postIdle(guild, channel);
      } catch (error) {
        log.warn(`패널 확인 실패 (${guild.name ?? guild.id}): ${messageOf(error)}`);
      }
    }
  }

  // 패널의 조작 버튼 두 줄. keepAutoplay: 나머지를 죽여도 자동재생만 살린다. 끝난 패널에서 다시 틀 수 있는 유일한 길이다.
  async createControlButtons(player: Controls, disabled = false, { keepAutoplay = false } = {}) {
    const id = (action: string) => panelId(action, player.sessionId);

    // Row 1: 이전곡 + 일시정지 + 스킵 + 정지 + 볼륨
    const previousButton = new ButtonBuilder()
      .setCustomId(id("previous"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(buttonEmoji("prev"))
      .setDisabled(disabled || !canBack(player));

    const pauseButton = new ButtonBuilder()
      .setCustomId(id("pause"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(buttonEmoji(player.paused ? "play" : "pause"))
      .setDisabled(disabled);

    const skipButton = new ButtonBuilder()
      .setCustomId(id("skip"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(buttonEmoji("next"))
      .setDisabled(disabled || !canSkip(player));

    const stopButton = new ButtonBuilder().setCustomId(id("stop")).setStyle(ButtonStyle.Danger).setEmoji(buttonEmoji("stop")).setDisabled(disabled);

    const volumeButton = new ButtonBuilder().setCustomId(id("volume")).setStyle(ButtonStyle.Secondary).setEmoji(buttonEmoji("volume")).setDisabled(disabled);

    // 둘째 줄: 섞기(아이콘만) · 반복 · 대기열 · 자동재생
    const shuffleButton = new ButtonBuilder().setCustomId(id("shuffle")).setStyle(ButtonStyle.Secondary).setEmoji(buttonEmoji("shuffle")).setDisabled(disabled);

    // 반복 버튼은 끔 → 한 곡 반복 → 대기열 반복 차례로 돈다
    const loopLook = LOOP_LOOKS[player.loop || "off"];
    const loopButton = new ButtonBuilder()
      .setCustomId(id("loop"))
      .setLabel(panelText.loopLabel(player.loop || "off"))
      .setStyle(loopLook.style)
      .setEmoji(buttonEmoji(loopLook.icon))
      .setDisabled(disabled);

    const labels = panelText.buttons();
    const queueButton = new ButtonBuilder().setCustomId(id("queue")).setLabel(labels.queue).setStyle(ButtonStyle.Primary).setEmoji(buttonEmoji("queue_button")).setDisabled(queueOff(player, disabled));

    const autoplayLook = AUTOPLAY_LOOKS[player.autoplay ? "on" : "off"];
    const autoplayButton = new ButtonBuilder()
      .setCustomId(id("autoplay"))
      .setLabel(labels.autoplay)
      .setStyle(autoplayLook.style)
      .setEmoji(buttonEmoji(autoplayLook.icon))
      .setDisabled(disabled && !keepAutoplay);

    // SponsorBlock 하이라이트 점프. 지점 없으면 비활성(스킵 버튼처럼 UI 일관성). 셔플 왼쪽. 봇 전체에서 SponsorBlock 을 껐으면 버튼을 두지 않는다
    const highlightAt = player.sponsor?.highlightAt;
    const hasHighlight = highlightAt !== null && highlightAt !== undefined;
    const highlightButton = new ButtonBuilder()
      .setCustomId(id("highlight"))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(buttonEmoji("highlight"))
      .setDisabled(disabled || !hasHighlight);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(previousButton, pauseButton, skipButton, stopButton, volumeButton);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(...(config.sponsorblock.enabled ? [highlightButton] : []), shuffleButton, loopButton, queueButton, autoplayButton);

    return [row, row2];
  }

  /**
   * 곡으로 건너뛰기 메뉴 줄. 디스코드가 컨테이너 안의 선택 메뉴 줄을 무시해서 컨테이너 밖 맨 위 줄로 둔다.
   * 대기열이 비었거나 재생 라벨이 없으면 null
   */
  async createJumpToRow(player: Pick<Player, "sessionId" | "queue">) {
    if (!player.sessionId || player.queue.length === 0) return null;

    const tracks = player.queue.slice(0, SELECT_MAX);
    const options = tracks.map((track, i) => {
      const label = `${i + 1}. ${songTitle(track.title)}`.slice(0, 100);
      const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i));
      const description = jumpDescription(track);
      if (description) opt.setDescription(description);
      return opt;
    });

    const placeholder = panelText.jumpPlaceholder();
    const select = new StringSelectMenuBuilder().setCustomId(panelId("jump", player.sessionId)).setPlaceholder(placeholder).addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /** 진행 막대를 PROGRESS_MS 마다 다시 그리기 시작한다 */
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
      // 고치기 실패는 _onEditFailed 가 구분한다. 여기까지 온 것은 모르는 오류라 남기고 이 곡의 갱신을 멈춘다(5초마다 같은 줄을 찍지 않게)
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

  /** 그 서버의 진행 막대 다시 그리기를 멈춘다 */
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
