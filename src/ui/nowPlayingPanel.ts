import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import { formatDuration } from "./format.ts";
import { progressBar, emptyProgressBar } from "./progressBar.ts";
import { labelOf, emojiOf } from "./platforms.ts";

/** 곡을 담은 결과를 알리는 매체(usecases/responders) */
type Responder = { notifyQueued(text: string): Promise<unknown>; dismissPlaceholder(): Promise<unknown> };

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
import { ErrorHandler } from "./errorMessages.ts";
import * as S from "./strings.ts";
import { ALLOWED_MENTIONS, escapeMd } from "./mentions.ts";
import * as GuildSettingsManager from "../store/guildSettings.ts";
import * as trackState from "../player/trackState.ts";
import { codeOf, messageOf } from "../rules/errorKind.ts";
import { canSend } from "./channels.ts";
import type { Client, Guild, GuildBasedChannel, GuildTextBasedChannel, Webhook, WebhookType } from "discord.js";
import type { MusicPlayer, PanelMessage } from "../player/Player.ts";
import type { QueuedTrack, Requester as TrackRequester } from "../player/track.ts";

// 편집 대상이 사라진 경우. 사용자가 메시지를 지웠거나 웹훅이 삭제됐다. 다시 올려야 한다.
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;
const isGone = (error: unknown) => codeOf(error) === UNKNOWN_MESSAGE || codeOf(error) === UNKNOWN_WEBHOOK;

// 패널 메시지가 있는 채널. 웹훅으로 올린 것은 API 모양이다
const channelIdOf = (message: PanelMessage) => ("channelId" in message ? message.channelId : message.channel_id);

/** 곡 담기 요청. 여러 곡이면 출처(collection)와 전체 곡 수(total)가 붙는다 */
type TrackData = { tracks: QueuedTrack[]; isPlaylist?: boolean; collection?: string | null; insertFirst?: boolean; insertAfterId?: string | null; total?: number | null; queueLimited?: boolean };
type Requester = TrackRequester | null;
/** 담은 결과. 실패면 message 가 안내 */
type AddResult = { success: true; dropped?: number; queueLimited?: boolean } | { success: false; message: string; dropped?: number };
/** 담은 안내에 붙일 것. dropped 상한으로 뺀 곡 수, total 받은 것보다 많은 전체 곡 수, queueLimited 자리가 모자라 덜 받음 */
type AdditionNotice = { dropped?: number; total?: number | null; queueLimited?: boolean };
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
type Controls = Pick<MusicPlayer, "sessionId" | "requesterId" | "previousTracks" | "queue" | "loop" | "paused" | "autoplay"> & Partial<Pick<MusicPlayer, "sponsor">>;

// 전용 채널에서 "묻혔다"고 보기까지 기다리는 시간. 안내 메시지는 10초 뒤 스스로 지워지므로
// 그보다 길게 잡아 잠깐 나타났다 사라지는 것을 쫓아다니지 않는다(transientMessages.AUTO_DELETE_MS).
const PIN_SETTLE_MS = 12000;
import { markTransient, isTransient } from "./transientMessages.ts";
import * as blankThumbnail from "./blankThumbnail.ts";
import { jumpDescription } from "./queueDisplay.ts";
import { NowPlayingPanel, type PanelStore } from "./panelLocation.ts";

// 끝난 패널의 버튼. 플레이어가 없어도 같은 모양을 그린다.
// 자동재생만 살아 있고, 그 버튼은 sessionId "idle"을 달고 나간다(buttonHandler가 앞에서 받아 낸다).
const IDLE_CONTROLS: Controls = { sessionId: "idle", requesterId: "0", previousTracks: [], queue: [], loop: false, paused: false, autoplay: false };

class MusicEmbedManager {
  client: Client;
  processingQueue = new Map<string, Promise<AddResult>>(); // guildId -> Promise 매핑
  updateIntervals = new Map<string, NodeJS.Timeout>(); // guildId -> intervalId 매핑
  webhookCache = new Map<string, WebhookClient>(); // channelId -> WebhookClient 매핑
  reposting = new Set<string>(); // 현재 재생 메시지를 다시 올리는 중인 guildId
  panel: NowPlayingPanel;
  idleViews = new Map<string, IdleView>(); // guildId → 끝난 패널의 문구 { reason, leavesAt }. 맨 아래로 다시 올릴 때 같은 모양으로
  repinTimers = new Map<string, NodeJS.Timeout>(); // guildId → 전용 채널 재고정 디바운스

  // panelStore: 패널 자리 기록. 시험은 메모리 가짜를 준다
  constructor(client: Client, { panelStore }: { panelStore?: PanelStore } = {}) {
    this.client = client;
    this.panel = new NowPlayingPanel(this, panelStore);
  }

  deleteWebhookCache(channelId: string) {
    const webhookClient = this.webhookCache.get(channelId);
    if (webhookClient) {
      try {
        webhookClient.destroy();
      } catch (_) {}
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
      log.error("웹훅 조회/생성 실패:", messageOf(error));
      return null;
    }
  }

  createSearchingContainer(msg: string) {
    return new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addTextDisplayComponents(new TextDisplayBuilder().setContent(msg));
  }

  createErrorContainer(msg: string) {
    return new ContainerBuilder().setAccentColor(resolveColor("#FF0000")).addTextDisplayComponents(new TextDisplayBuilder().setContent(S.withErrorMark(msg)));
  }

  /**
   * 음악 데이터를 처리하고 적절한 임베드를 전송/갱신합니다.
   *
   * 서버당 한 번에 하나의 작업만. Promise tail 체인 방식.
   * "기다렸다가 등록"(await 후 set)은 대기와 등록 사이에 끼어든 요청이 락을 놓치고,
   * 앞 작업의 finally가 뒤 작업의 Map 항목을 지우는 경쟁이 있었다(A/B/C 동시 시나리오).
   * 여기서는 get+set이 동기(사이에 await 없음)라 끼어들 틈이 없고, 정리도 자기 항목일 때만 한다.
   */
  // responder: 결과를 알릴 매체(usecases/responders). 없으면(재생 시작 알림 등) 알리지 않는다
  handleMusicData(guildId: string, trackData: TrackData, requester: Requester, responder: Responder = NO_RESPONDER) {
    const tail = this.processingQueue.get(guildId) || Promise.resolve();
    // 앞 작업의 실패가 뒤 작업까지 실패시키면 안 됨. 각 작업의 결과/오류는 자기 호출자에게만 전달
    const processingPromise = tail.catch(() => {}).then(() => this._processMusic(guildId, trackData, requester, responder));
    this.processingQueue.set(guildId, processingPromise);

    return processingPromise.finally(() => {
      if (this.processingQueue.get(guildId) === processingPromise) {
        this.processingQueue.delete(guildId);
      }
    });
  }

  async _processMusic(guildId: string, trackData: TrackData, requester: Requester, responder: Responder): Promise<AddResult> {
    const player = this.client.players.get(guildId);
    if (!player) return { success: false, message: "음악 플레이어를 찾을 수 없습니다." };

    const wasPlayingBefore = player.currentTrack !== null;
    // 여러 곡을 담았으면 그 출처의 표시 이름(재생목록·앨범 등), 한 곡이면 null
    const sourceLabel = trackData.isPlaylist ? S.collectionLabel(trackData.collection) : null;
    const insertFirst = trackData.insertFirst || false;
    const tracks = trackData.tracks;

    try {
      let firstTrackResult: { success: true } | null = null;
      let startFailure: string | null = null; // 첫 곡 재생 시작 실패 메시지(있으면 유령 임베드 안 만들고 실패 전파)
      const wasIdle = !player.currentTrack && player.queue.length === 0;
      const tracksToQueue: QueuedTrack[] = [];

      // 모든 트랙을 플레이어에 추가 (사전 로드 트리거)
      for (let i = 0; i < tracks.length; i++) {
        const track = { ...tracks[i] };
        track.requestedBy = requester;
        track.addedAt = Date.now();

        // 첫 번째 트랙이고 플레이어가 유휴 상태이면 재생 시작
        if (i === 0 && wasIdle) {
          trackState.setCurrent(player, track);

          // 음성 채널에 연결하고 재생 시작
          let playbackStarted = false;
          try {
            if (!player.connection) {
              await player.connect();
            }
            const playResult = await player.play();
            // play()는 실패를 throw가 아니라 {success:false}로 알린다. 이걸 무시하면
            // 재생이 안 됐는데도 아래에서 now-playing 임베드를 만들어 '유령 재생'이 된다.
            if (playResult && playResult.ok === false) {
              startFailure = ErrorHandler.playFailure(playResult);
            } else {
              playbackStarted = true;
            }
          } catch (playError) {
            log.error("재생 처리 중 오류:", playError);
            startFailure = ErrorHandler.getMessage(playError);
          }

          if (startFailure) {
            // 시작 실패. 유령 임베드 만들지 않음. 실패한 곡은 큐에 넣지 않는다(재시도해도 실패).
            trackState.setCurrent(player, null);
          } else if (playbackStarted) {
            // UI 실패가 재생 상태를 망가뜨리면 안 됨. 임베드를 생성할 수 없어도(예: CV2 수정 제한) 재생은 계속 진행
            try {
              firstTrackResult = await this.createNewMusicEmbed(player, track, requester, responder);
            } catch (embedError) {
              log.error("재생 중 임베드 생성 실패:", embedError);
              firstTrackResult = { success: true };
            }
          }
        } else {
          tracksToQueue.push(track);
        }
      }

      // 상한은 여기서 판정한다. 해석이 끝난 뒤 서버별로 줄 선 구간이라, 동시에 온 목록이 같은 빈자리를 두 번 쓰지 않는다
      const queued = tracksToQueue.slice(0, trackState.roomLeft(player, config.bot.maxQueueSize));
      const dropped = tracksToQueue.length - queued.length;
      // 안내에 붙일 것. 전체 곡 수는 받은 것보다 많을 때만
      const notice = { dropped, total: trackData.total && trackData.total > tracks.length ? trackData.total : null, queueLimited: Boolean(trackData.queueLimited) };
      if (trackData.insertAfterId) trackState.insertAfter(player, trackData.insertAfterId, queued);
      else if (insertFirst) trackState.enqueue(player, queued, { front: true });
      // 자동재생이 미리 뽑아 둔 곡보다는 앞에. 사용자가 고른 곡이 먼저다
      else trackState.enqueueAheadOfAutoplay(player, queued);

      // 첫 곡이 실패했지만 대기열에 다음 곡이 있으면(재생목록) 다음 곡부터 재생 시도.
      if (startFailure && !player.currentTrack && player.queue.length > 0) {
        try {
          const nextResult = await player.play(0);
          if (nextResult && nextResult.ok !== false && player.currentTrack) {
            startFailure = null;
            try {
              firstTrackResult = await this.createNewMusicEmbed(player, player.currentTrack, requester, responder);
            } catch {
              firstTrackResult = { success: true };
            }
          }
        } catch (e) {
          log.error("첫 곡 실패 후 다음 곡 시작 실패:", messageOf(e));
        }
      }

      // 첫 곡 실패 + 되살릴 것 없음 → 실패 반환(명령 editReply / 대시보드 응답 / 메시지 답장이 사용자에게 표기).
      if (startFailure && !firstTrackResult) {
        return { success: false, message: startFailure };
      }

      // 첫 번째 트랙이 재생을 시작했고 재생목록에 남은 트랙이 있음
      if (firstTrackResult && tracks.length > 1) {
        // 남은 재생목록 트랙이 대기열에 추가되었음을 메시지로 표시
        await this.showPlaylistAdditionMessage(player, queued, sourceLabel, insertFirst, notice);
        // 대기열 갱신. 임베드 새로고침
        await this.updateNowPlayingEmbed(player);
        return { ...firstTrackResult, dropped, queueLimited: notice.queueLimited };
      }

      // 대기열에만 추가됨 (이미 음악 재생 중)
      if (wasPlayingBefore || (!firstTrackResult && tracks.length > 0)) {
        if (queued.length === 0 && dropped > 0) return { success: false, message: this.queueFullMessage(), dropped };
        return await this.handleQueueAddition(player, queued, responder, sourceLabel, insertFirst, notice);
      }

      // 단일 트랙 재생 시작
      if (firstTrackResult) {
        return firstTrackResult;
      }

      return { success: true };
    } catch {
      return { success: false, message: "음악을 처리하는 중 오류가 발생했습니다." };
    }
  }

  /**
   * 첫 번째 트랙이 재생되는 동안 남은 재생목록 트랙이 추가되었음을 메시지로 표시
   */
  async showPlaylistAdditionMessage(player: MusicPlayer, queued: QueuedTrack[], sourceLabel: string | null, insertFirst = false, notice: AdditionNotice = {}) {
    const messageText = this.createQueueAdditionMessage(queued, sourceLabel, insertFirst, notice);

    // 진입점의 응답이 아니라 항상 텍스트 채널로. 채널이 없는 경로(대시보드)는 생략
    if (!player.textChannel || typeof player.textChannel.send !== "function") return;

    try {
      const infoMessage = await player.textChannel.send({ content: messageText });
      markTransient(infoMessage?.id, 10000);

      // 10초 후 정보 메시지 삭제
      setTimeout(async () => {
        try {
          await infoMessage.delete();
        } catch {
          // 메시지가 이미 삭제되었을 수 있음
        }
      }, 10000);
    } catch (error) {
      log.error("재생목록 추가 안내 전송 실패:", error);
    }
  }

  /**
   * 새 음악 임베드 생성 (현재 재생 중인 곡이 없을 때)
   */
  async createNewMusicEmbed(player: MusicPlayer, track: QueuedTrack, requester: Requester, responder: Responder = NO_RESPONDER, { reuse = true } = {}): Promise<{ success: true }> {
    if (player?.guild?.id) playerEvents.touched(player.guild.id); // 대시보드 SSE 넛지 (새로 틀기 시작함)
    const channel = await this._panelChannel(player);
    // 보낼 채널이 없으면 재생은 계속하되 임베드만 건너뛴다
    if (!canSend(channel)) {
      return { success: true };
    }

    player.requesterId = requester?.id ?? null; // 버튼 custom_id가 쓴다. 그리기 전에
    this.idleViews.delete(player.guild.id);

    // 전용 채널 맨 아래의 끝난 패널은 그 자리를 재생 화면으로 고친다. 아니면 새로 올리고 지난 패널을 치운다.
    const reused = reuse ? await this._reuseIdlePanel(player, channel, track) : null;
    const { message, webhook } = reused ?? (await this._sendNowPlaying(player, track, channel));
    player.nowPlayingWebhook = webhook;
    if (!reused) await this.panel.commit(player.guild, channel, message, webhook);

    // 진입점이 띄운 "검색 중…" 자리표시자 제거. 채널에 중복/정지 메시지를 남기지 않는다
    await responder.dismissPlaceholder();

    player.nowPlayingMessage = message;

    this.startProgressUpdate(player);

    return { success: true };
  }

  /**
   * 음악 재생 중 곡이 대기열에 추가되는 경우를 처리합니다.
   */
  async handleQueueAddition(player: MusicPlayer, tracks: QueuedTrack[], responder: Responder, sourceLabel: string | null, insertFirst = false, notice: AdditionNotice = {}): Promise<AddResult> {
    // 기존 임베드 갱신
    if (player.nowPlayingMessage && player.currentTrack) {
      await this.updateNowPlayingEmbed(player);
    }

    await responder.notifyQueued(this.createQueueAdditionMessage(tracks, sourceLabel, insertFirst, notice));

    return { success: true, dropped: notice.dropped ?? 0, queueLimited: Boolean(notice.queueLimited) };
  }

  /**
   * 현재 재생 메시지를 채널에 보냅니다. 참조 갱신은 호출자 몫.
   *
   * 지속되는 now-playing 메시지는 상호작용 유무와 무관하게 항상 채널 웹훅(실패 시 일반 채널 메시지)으로 보낸다.
   * 상호작용 응답(@original)으로 보내면 이후 편집이 상호작용 토큰을 사용하는데, 이 토큰은 생성 15분 뒤 만료되어
   * 장시간 세션에서 진행바/트랙 갱신이 50027(Invalid Webhook Token)로 실패한다. 웹훅/봇 토큰은 만료되지 않는다.
   * (부수 효과로 메시지에 webhook_id가 붙어 CV2 이모지 링크 렌더링도 올바르게 유지된다.)
   */
  async _sendNowPlaying(player: MusicPlayer, track: QueuedTrack, channel: GuildTextBasedChannel) {
    return this._sendPanel(channel, await this._playingPayload(player, track));
  }

  async _sendPanel(channel: GuildTextBasedChannel, payload: Payload): Promise<{ message: PanelMessage; webhook: WebhookClient | null }> {
    const webhook = await this.getOrCreateWebhook(channel);
    if (!webhook) return { message: await channel.send(payload), webhook: null };

    const me = this.client.user;
    const message = await webhook.send({
      ...payload,
      username: me?.displayName || me?.username,
      avatarURL: me?.displayAvatarURL(),
    });
    return { message, webhook };
  }

  async _playingPayload(player: MusicPlayer, track: QueuedTrack): Promise<Payload> {
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
  async _panelChannel(player: MusicPlayer) {
    return (await this._dedicatedChannel(player.guild, player.textChannel)) ?? player.textChannel;
  }

  // 전용 채널 맨 아래에 끝난 패널이 있으면 재생 화면으로 고친다. 고쳤으면 { message, webhook }
  async _reuseIdlePanel(player: MusicPlayer, channel: GuildTextBasedChannel, track: QueuedTrack) {
    if ((await this._dedicatedChannel(player.guild, channel))?.id !== channel.id) return null;
    const record = await this.panel.store.getPanel(player.guild.id);
    if (record?.channelId !== channel.id || this._buriedAt(channel, record.messageId)) return null;
    // 종료 모양이 붙여 둔 투명 썸네일 첨부를 뗀다
    const edited = await this.panel.edit(player.guild, { ...(await this._playingPayload(player, track)), attachments: [] });
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
  async _repostNowPlaying(player: MusicPlayer, reason: string) {
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
      await this.panel.commit(player.guild, channel, message, webhook);
      log.info({ tags: ["recovered"] }, `재생 중 임베드 다시 올림: ${reason}`);
    } catch (error) {
      // 다시 올리지 못하면 참조를 버린다. 5초마다 같은 실패를 반복하면 그게 도배다
      player.nowPlayingMessage = null;
      this.stopProgressUpdate(guildId);
      log.error("재생 중 임베드 다시 올리기 실패:", messageOf(error));
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
  async _isBuried(player: MusicPlayer, now = Date.now()) {
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
  async createNowPlayingContainer(player: MusicPlayer, track: QueuedTrack, buttonsDisabled = false) {
    const nowPlayingTitle = "🎵 현재 재생 중";

    const currentMs = player.getCurrentTime ? player.getCurrentTime() : 0;
    const currentSec = Math.floor(currentMs / 1000);
    const totalSec = track.duration || 0;
    const bar = progressBar(currentSec, totalSec, { live: Boolean(player.isLive ?? track.isLive) });

    const artistValue = track.artist || "-";
    const platformValue = this.getPlatformLabel(track.platform);

    const artistLine = artistValue && artistValue !== "-" ? `\n-# 👤 ${escapeMd(artistValue)}` : "";
    // 제목은 이스케이프하지 않는다. 링크 라벨 안에서는 백슬래시가 그대로 노출된다(mentions.ts).
    // 보여 줄 링크(pageUrl)를 건다. 음원을 직접 트는 곡도 음원 파일이 아니라 출처 페이지다
    const linkText = `### ${nowPlayingTitle}\n**[${track.title}](${track.pageUrl})**${artistLine}`;

    // Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
    // 직접 링크는 썸네일이 없으므로(임의 URL이라 앨범아트를 알 수 없다) 텍스트만 넣는다.
    const titleComponent = track.thumbnail ? new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail)) : null;

    // 상태 줄 (일시정지 / 대기열 수)
    // 라이브 표식은 진행바의 경과 시간 자리에 있다(buildProgressBar). 여기서 또 내지 않는다.
    const statusParts = [];
    if (player.paused) {
      if (player.pauseReasons?.has("mute")) statusParts.push("🔇 뮤트됨");
      else if (player.pauseReasons?.has("alone")) statusParts.push("⏳ 혼자 남음");
      else statusParts.push("⏸️ 일시정지");
    }
    if (player.queue.length > 0) {
      statusParts.push(`${player.queue.length}개의 노래 대기 중`);
    }
    if (player.sponsor?.skipSegments?.length) {
      statusParts.push(`건너 뛸 구간 ${player.sponsor.skipSegments.length}개`);
    }

    const container = new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor));
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

    // 구분선 + 대시보드 링크
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🔗 [대시보드](${config.dashboard.url})  |  🖥️ ${platformValue}`));

    return container;
  }

  /**
   * 진행 바 문자열을 빌드합니다.
   */
  /**
   * 현재 재생 임베드를 제자리에서 갱신합니다.
   */
  async updateNowPlayingEmbed(player: MusicPlayer) {
    if (player?.guild?.id) playerEvents.touched(player.guild.id); // 대시보드 SSE 넛지 (Discord 임베드 유무와 무관하게 발신)
    const panel = player.nowPlayingMessage;
    if (!panel || !player.currentTrack) return;
    if (this.reposting.has(player.guild.id)) return; // 다시 올리는 중. 그쪽이 최신 내용으로 보낸다

    try {
      const payload = await this._playingPayload(player, player.currentTrack);
      // 웹훅이 없으면 채널로 보낸 Message 다
      if (player.nowPlayingWebhook) await player.nowPlayingWebhook.editMessage(panel.id, payload);
      else if ("edit" in panel) await panel.edit(payload);
    } catch (error) {
      // 편집 대상이 없어졌다. 참조를 붙든 채 5초마다 같은 오류를 찍는 대신 다시 올린다
      if (isGone(error)) {
        if (codeOf(error) === UNKNOWN_WEBHOOK) {
          const channel = await this._panelChannel(player);
          if (channel?.id) this.deleteWebhookCache(channel.id);
          player.nowPlayingWebhook = null;
        }
        await this._repostNowPlaying(player, "메시지가 지워짐");
        return;
      }
      log.error("재생 중 임베드 갱신 실패:", error);
    }
  }

  /**
   * 끝난 패널. 재생 화면과 같은 구조에 버튼만 끈다. 썸네일 자리는 투명 이미지로 채워 줄 구성을 맞춘다.
   * 곡 정보는 쓰지 않는다. 부르는 곳이 현재 곡을 먼저 비운다.
   * reason: queue-end(음성에 잠시 남음) | stop · disconnected(나감) | leave(세션 저장됨) | joined(/join만 함)
   */
  async createIdleContainer({ reason = "stop", dedicated = false, leavesAt = null }: IdleView & { dedicated?: boolean } = { reason: "stop" }) {
    let title: string, status: string;
    if (reason === "leave") {
      [title, status] = ["듣고 있던 곡이 있어요", "💾 `/join`으로 이어 들을 수 있어요"];
    } else if (leavesAt) {
      [title, status] = [reason === "joined" ? "곡을 기다리고 있어요" : "재생이 끝났어요", `🌙 <t:${Math.round(leavesAt / 1000)}:R> 쉬러 갈게요`];
    } else {
      [title, status] = ["쉬는 중이에요", dedicated ? "👋 곡을 입력하면 다시 올게요" : "👋 `/play`로 부르면 다시 올게요"];
    }

    const heading = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 💤 재생 대기 중\n**${title}**\n-# ${status}`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(blankThumbnail.url));

    const container = new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addSectionComponents(heading).addTextDisplayComponents(new TextDisplayBuilder().setContent(emptyProgressBar())).addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    for (const row of await this.createControlButtons(IDLE_CONTROLS, true, { keepAutoplay: true })) container.addActionRowComponents(row);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🔗 [대시보드](${config.dashboard.url})`));

    return { components: [container], files: [blankThumbnail.file()] };
  }

  /**
   * 재생이 끝났을 때. 패널을 종료 모양으로 바꾼다. 살아 있는 패널이 없으면 기록된 끝난 패널의 문구만 고친다
   * (대기 중에 음성에서 나감 등). 종료 메시지는 전용 채널 밖에서, 방금까지 재생하던 때만 올린다.
   */
  async handlePlaybackEnd(player: MusicPlayer, { reason = "stop" } = {}) {
    const guild = player.guild;
    if (guild?.id) playerEvents.touched(guild.id); // 대시보드 SSE 넛지 (종료/정지)
    this.stopProgressUpdate(guild?.id);

    const live = player.nowPlayingMessage;
    const textChannel = player.textChannel;
    // 패널은 요청한 채널이 아니라 전용 채널에 있을 수 있다. textChannel로 판단하면 엉뚱한 채널에 종료 메시지가 간다
    const panelChannelId = live ? (channelIdOf(live) ?? (await this._panelChannel(player))?.id) : guild?.id && (await this.panel.store.getPanel(guild.id))?.channelId;
    const botChannelId = guild?.id ? await GuildSettingsManager.getBotChannel(guild.id) : null;
    const dedicated = Boolean(panelChannelId) && panelChannelId === botChannelId;

    const leaveMs = config.bot.leaveDelayQueueEmptyMs;
    const view: IdleView = { reason, leavesAt: (reason === "queue-end" || reason === "joined") && leaveMs > 0 ? Date.now() + leaveMs : null };
    if (guild?.id) this.idleViews.set(guild.id, view);

    try {
      const payload: Payload = { ...(await this.createIdleContainer({ ...view, dedicated })), flags: MessageFlags.IsComponentsV2 };
      if (live && player.nowPlayingWebhook) await player.nowPlayingWebhook.editMessage(live.id, payload);
      else if (live && "edit" in live) await live.edit(payload);
      else if (guild?.id) await this.panel.edit(guild, payload);
    } catch (error) {
      // 이미 지워진 패널을 못 바꿨다는 것은 알릴 일이 아니다
      if (!isGone(error)) log.error("패널을 종료 모양으로 바꾸지 못함:", error);
    }

    // 전용 채널 밖의 패널은 대화에 밀려 어디까지 올라갔을지 모른다
    if (live && !dedicated && canSend(textChannel)) {
      const endEmbed = new EmbedBuilder().setTitle("🎵 음악 종료됨").setDescription("모든 노래가 재생되었습니다! `/play` 명령을 사용하여 새 트랙을 추가하세요.").setColor("#FF6B6B").setTimestamp();
      await textChannel.send({ embeds: [endEmbed] }).catch(() => {}); // 채널을 쓸 수 없거나 권한이 없음
    }

    // 플레이어 정리
    trackState.setCurrent(player, null);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
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
    const record = await this.panel.store.getPanel(guild.id);
    if (record?.channelId !== channel.id || !this._buriedAt(channel, record.messageId, now)) return;

    await this._postIdle(guild, channel);
  }

  // 끝난 패널을 이 채널 맨 아래에 올리고 이 서버의 패널로 삼는다
  async _postIdle(guild: Guild, channel: GuildTextBasedChannel, { dedicated = true } = {}) {
    const view: IdleView = this.idleViews.get(guild.id) ?? { reason: "stop" }; // 재시작 뒤라면 음성 밖이다
    const payload: Payload = { ...(await this.createIdleContainer({ ...view, dedicated })), flags: MessageFlags.IsComponentsV2 };
    const { message, webhook } = await this._sendPanel(channel, payload);
    await this.panel.commit(guild, channel, message, webhook);
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
    else await this.panel.remove(guild);
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
        const record = await this.panel.store.getPanel(guild.id);
        if (record && (!channel || record.channelId === channel.id)) {
          const payload: Payload = { ...(await this.createIdleContainer({ reason: "stop", dedicated: Boolean(channel) })), flags: MessageFlags.IsComponentsV2 };
          if (await this.panel.edit(guild, payload)) continue;
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
    const sessionId = player.sessionId;
    const requesterId = player.requesterId;

    // Row 1: 이전곡 + 일시정지 + 스킵 + 정지 + 볼륨
    const previousButton = new ButtonBuilder()
      .setCustomId(`music_previous:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏮️")
      .setDisabled(disabled || (player.previousTracks.length === 0 && player.loop !== "track")); // 한곡 반복 = 재시작이라 기록 없어도 활성

    const pauseButton = new ButtonBuilder()
      .setCustomId(`music_pause:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setDisabled(disabled);

    const skipButton = new ButtonBuilder()
      .setCustomId(`music_skip:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setDisabled(disabled || (player.queue.length === 0 && player.loop !== "track" && !player.autoplay)); // 한곡 반복은 재시작, 자동재생은 다음 곡을 골라 대기열이 비어도 활성

    const stopButton = new ButtonBuilder().setCustomId(`music_stop:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Danger).setEmoji("⏹️").setDisabled(disabled);

    const volumeButton = new ButtonBuilder().setCustomId(`music_volume:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("🔊").setDisabled(disabled);

    // Row 2: 셔플(아이콘만) + 반복 + 대기열 + 자동재생
    const shuffleButton = new ButtonBuilder().setCustomId(`music_shuffle:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("🔀").setDisabled(disabled);

    // 반복 버튼. 꺼짐 → 트랙 → 대기열 순환
    let loopLabel: string, loopEmoji: string, loopStyle: ButtonStyle;
    if (player.loop === "track") {
      loopLabel = "반복: 트랙";
      loopEmoji = "🔂";
      loopStyle = ButtonStyle.Success;
    } else if (player.loop === "queue") {
      loopLabel = "반복: 대기열";
      loopEmoji = "🔁";
      loopStyle = ButtonStyle.Success;
    } else {
      loopLabel = "반복: 꺼짐";
      loopEmoji = "➡️";
      loopStyle = ButtonStyle.Secondary;
    }

    const loopButton = new ButtonBuilder().setCustomId(`music_loop:${requesterId}:${sessionId}`).setLabel(loopLabel).setStyle(loopStyle).setEmoji(loopEmoji).setDisabled(disabled);

    const queueButton = new ButtonBuilder().setCustomId(`music_queue:${requesterId}:${sessionId}`).setLabel("대기열").setStyle(ButtonStyle.Primary).setEmoji("📋").setDisabled(disabled);

    const autoplayButton = new ButtonBuilder()
      .setCustomId(`music_autoplay:${requesterId}:${sessionId}`)
      .setLabel("자동재생")
      .setStyle(player.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🎲")
      .setDisabled(disabled && !keepAutoplay);

    // SponsorBlock 하이라이트 점프. 항상 표시, 지점 없으면 비활성(스킵 버튼처럼 UI 일관성). 셔플 왼쪽.
    const highlightAt = player.sponsor?.highlightAt;
    const hasHighlight = highlightAt !== null && highlightAt !== undefined;
    const highlightButton = new ButtonBuilder()
      .setCustomId(`music_highlight:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💡")
      .setDisabled(disabled || !hasHighlight);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(previousButton, pauseButton, skipButton, stopButton, volumeButton);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(highlightButton, shuffleButton, loopButton, queueButton, autoplayButton);

    return [row, row2];
  }

  /**
   * 대기열 이동 선택 메뉴를 독립 ActionRow로 빌드합니다.
   * Discord가 Container 안에 중첩된 선택 메뉴 ActionRow를 무시하므로 최상위 components 배열에 배치해야 합니다 (Container 안이 아님).
   * 대기열이 비었거나 플레이어 상태가 없으면 null을 반환합니다.
   */
  async createJumpToRow(player: Pick<MusicPlayer, "requesterId" | "sessionId" | "queue">) {
    if (!player.requesterId || !player.sessionId || player.queue.length === 0) return null;

    const tracks = player.queue.slice(0, 25);
    const options = tracks.map((track, i) => {
      const label = `${i + 1}. ${track.title}`.slice(0, 100);
      const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i));
      const description = jumpDescription(track);
      if (description) opt.setDescription(description);
      return opt;
    });

    const placeholder = "⏭ 이 곡으로 바로 이동...";
    const select = new StringSelectMenuBuilder().setCustomId(`music_jumpto:${player.requesterId}:${player.sessionId}`).setPlaceholder(placeholder).addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * 대기열 추가 메시지를 빌드합니다.
   * sourceLabel 은 여러 곡을 담은 출처의 표시 이름(재생목록·앨범 등). 없으면 한 곡 안내
   */
  createQueueAdditionMessage(tracks: Array<Pick<QueuedTrack, "title">>, sourceLabel: string | null, insertFirst = false, { dropped = 0, total = null, queueLimited = false }: AdditionNotice = {}) {
    let text: string;
    if (sourceLabel) {
      text = insertFirst ? `⏫ ${sourceLabel}의 ${tracks.length}개 노래가 대기열 맨 앞에 추가되었습니다!` : `✅ ${sourceLabel}의 ${tracks.length}개 노래가 대기열에 추가되었습니다!`;
    } else {
      const title = escapeMd(tracks[0]?.title || "알 수 없는 트랙");
      text = insertFirst ? `⏫ **${title}**가 대기열 맨 앞에 추가되었습니다!` : `✅ **${title}**가 대기열에 추가되었습니다!`;
    }
    if (sourceLabel && total) text += ` (전체 ${total.toLocaleString("ko-KR")}곡)`;
    if (dropped > 0) text += `\n⚠️ 대기열이 가득 차 ${dropped}곡은 넣지 못했습니다 (최대 ${config.bot.maxQueueSize}곡)`;
    else if (queueLimited) text += `\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다 (최대 ${config.bot.maxQueueSize}곡)`;
    return text;
  }

  queueFullMessage() {
    return `대기열이 가득 찼습니다 (최대 ${config.bot.maxQueueSize}곡)`;
  }

  /**
   * 초 단위 길이를 H:MM:SS 또는 M:SS 형식으로 변환합니다. (공용 구현: src/ui/format.ts)
   */
  formatDuration(seconds: number | string | null | undefined) {
    return formatDuration(seconds);
  }

  /**
   * 플랫폼 이름에 해당하는 명칭과 이모지를 반환합니다. 모르는 값은 첫 글자만 대문자로 올립니다.
   */
  getPlatformLabel(platform: string | null | undefined) {
    return labelOf(platform);
  }

  getPlatformEmoji(platform: string | null | undefined) {
    return emojiOf(platform);
  }

  /**
   * 진행 바를 새로고침하는 5초 간격 타이머를 시작합니다.
   */
  startProgressUpdate(player: MusicPlayer) {
    this.stopProgressUpdate(player.guild.id);
    const intervalId = setInterval(async () => {
      if (!player.currentTrack || !player.nowPlayingMessage) {
        this.stopProgressUpdate(player.guild.id);
        return;
      }
      try {
        if (await this._isBuried(player)) await this._repostNowPlaying(player, "전용 채널 맨 아래로");
        else await this.updateNowPlayingEmbed(player);
      } catch {
        this.stopProgressUpdate(player.guild.id);
      }
    }, 5000);
    this.updateIntervals.set(player.guild.id, intervalId);
  }

  /**
   * 서버의 진행 갱신 타이머를 중지합니다.
   */
  stopProgressUpdate(guildId: string | undefined) {
    if (!guildId) return;
    const id = this.updateIntervals.get(guildId);
    if (id) {
      clearInterval(id);
      this.updateIntervals.delete(guildId);
    }
  }
}

export { MusicEmbedManager };
export type { TrackData, AddResult, Responder };
