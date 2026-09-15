const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient } = require("discord.js");
const log = require("./logger").child({ category: "player" });
const config = require("../config");
const { formatDuration } = require("./utils");
const DashboardEvents = require("./DashboardEvents");
const ErrorHandler = require("./ErrorHandler");
const S = require("./strings");
const { ALLOWED_MENTIONS, escapeMd } = require("./mentions");
const { silentResponder } = require("./playbackResponder");
const GuildSettingsManager = require("./GuildSettingsManager");
const trackState = require("./trackState");

// 편집 대상이 사라진 경우 — 사용자가 메시지를 지웠거나 웹훅이 삭제됐다. 다시 올려야 한다.
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;
const isGone = (error) => error?.code === UNKNOWN_MESSAGE || error?.code === UNKNOWN_WEBHOOK;

// 전용 채널에서 "묻혔다"고 보기까지 기다리는 시간. 안내 메시지는 10초 뒤 스스로 지워지므로
// 그보다 길게 잡아 잠깐 나타났다 사라지는 것을 쫓아다니지 않는다(playbackResponder.AUTO_DELETE_MS).
const PIN_SETTLE_MS = 12000;

class MusicEmbedManager {
  constructor(client) {
    this.client = client;
    this.processingQueue = new Map(); // guildId -> Promise 매핑
    this.updateIntervals = new Map(); // guildId -> intervalId 매핑
    this.webhookCache = new Map(); // channelId -> WebhookClient 매핑
    this.reposting = new Set(); // 현재 재생 메시지를 다시 올리는 중인 guildId
  }

  deleteWebhookCache(channelId) {
    const webhookClient = this.webhookCache.get(channelId);
    if (webhookClient) {
      try {
        webhookClient.destroy();
      } catch (_) {}
      this.webhookCache.delete(channelId);
    }
  }

  async getOrCreateWebhook(channel) {
    if (this.webhookCache.has(channel.id)) {
      return this.webhookCache.get(channel.id);
    }
    try {
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find((wh) => wh.owner?.id === this.client.user.id && wh.name === "Music Now Playing");
      if (!webhook) {
        webhook = await channel.createWebhook({ name: "Music Now Playing" });
      }
      const client = new WebhookClient({ id: webhook.id, token: webhook.token }, { allowedMentions: ALLOWED_MENTIONS });
      this.webhookCache.set(channel.id, client);
      return client;
    } catch (error) {
      log.error("웹훅 조회/생성 실패:", error.message);
      return null;
    }
  }

  createSearchingContainer(msg) {
    return new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addTextDisplayComponents(new TextDisplayBuilder().setContent(msg));
  }

  createErrorContainer(msg) {
    return new ContainerBuilder().setAccentColor(resolveColor("#FF0000")).addTextDisplayComponents(new TextDisplayBuilder().setContent(S.withErrorMark(msg)));
  }

  /**
   * 음악 데이터를 처리하고 적절한 임베드를 전송/갱신합니다.
   *
   * 서버당 한 번에 하나의 작업만 — Promise tail 체인 방식.
   * "기다렸다가 등록"(await 후 set)은 대기와 등록 사이에 끼어든 요청이 락을 놓치고,
   * 앞 작업의 finally가 뒤 작업의 Map 항목을 지우는 경쟁이 있었다(A/B/C 동시 시나리오).
   * 여기서는 get+set이 동기(사이에 await 없음)라 끼어들 틈이 없고, 정리도 자기 항목일 때만 한다.
   */
  handleMusicData(guildId, trackData, requester, responder = silentResponder) {
    const tail = this.processingQueue.get(guildId) || Promise.resolve();
    // 앞 작업의 실패가 뒤 작업까지 실패시키면 안 됨 — 각 작업의 결과/오류는 자기 호출자에게만 전달
    const processingPromise = tail.catch(() => {}).then(() => this._processMusic(guildId, trackData, requester, responder));
    this.processingQueue.set(guildId, processingPromise);

    return processingPromise.finally(() => {
      if (this.processingQueue.get(guildId) === processingPromise) {
        this.processingQueue.delete(guildId);
      }
    });
  }

  async _processMusic(guildId, trackData, requester, responder) {
    const player = this.client.players.get(guildId);
    if (!player) return { success: false, message: "음악 플레이어를 찾을 수 없습니다." };

    const wasPlayingBefore = player.currentTrack !== null;
    // 여러 곡을 담았으면 그 출처의 표시 이름(재생목록·앨범 등), 한 곡이면 null
    const sourceLabel = trackData.isPlaylist ? S.collectionLabel(trackData.collection) : null;
    const insertFirst = trackData.insertFirst || false;
    const tracks = trackData.tracks;

    try {
      let firstTrackResult = null;
      let startFailure = null; // 첫 곡 재생 시작 실패 메시지(있으면 유령 임베드 안 만들고 실패 전파)
      const wasIdle = !player.currentTrack && player.queue.length === 0;
      const tracksToQueue = [];

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
            if (playResult && playResult.success === false) {
              startFailure = playResult.message || "재생을 시작할 수 없습니다.";
            } else {
              playbackStarted = true;
            }
          } catch (playError) {
            log.error("재생 처리 중 오류:", playError);
            startFailure = ErrorHandler.getMessage(playError);
          }

          if (startFailure) {
            // 시작 실패 — 유령 임베드 만들지 않음. 실패한 곡은 큐에 넣지 않는다(재시도해도 실패).
            trackState.setCurrent(player, null);
          } else if (playbackStarted) {
            // UI 실패가 재생 상태를 망가뜨리면 안 됨 — 임베드를 생성할 수 없어도(예: CV2 수정 제한) 재생은 계속 진행
            try {
              firstTrackResult = await this.createNewMusicEmbed(player, track, requester, responder);
            } catch (embedError) {
              log.error("재생 중 임베드 생성 실패:", embedError);
              firstTrackResult = { success: true, message: "Now playing", isNewEmbed: false };
            }
          }
        } else {
          tracksToQueue.push(track);
        }
      }

      // 상한은 여기서 판정한다 — 해석이 끝난 뒤 서버별로 줄 선 구간이라, 동시에 온 목록이 같은 빈자리를 두 번 쓰지 않는다
      const queued = tracksToQueue.slice(0, trackState.roomLeft(player, config.bot.maxQueueSize));
      const dropped = tracksToQueue.length - queued.length;
      // 안내에 붙일 것 — 전체 곡 수는 받은 것보다 많을 때만
      const notice = { dropped, total: trackData.total > tracks.length ? trackData.total : null, queueLimited: Boolean(trackData.queueLimited) };
      trackState.enqueue(player, queued, { front: insertFirst });

      // 첫 곡이 실패했지만 대기열에 다음 곡이 있으면(재생목록) 다음 곡부터 재생 시도.
      if (startFailure && !player.currentTrack && player.queue.length > 0) {
        try {
          const nextResult = await player.play(null, 0);
          if (nextResult && nextResult.success !== false && player.currentTrack) {
            startFailure = null;
            try {
              firstTrackResult = await this.createNewMusicEmbed(player, player.currentTrack, requester, responder);
            } catch {
              firstTrackResult = { success: true, isNewEmbed: false };
            }
          }
        } catch (e) {
          log.error("첫 곡 실패 후 다음 곡 시작 실패:", e?.message || e);
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
        // 대기열 갱신 — 임베드 새로고침
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

      return { success: true, message: "Track processed successfully" };
    } catch (error) {
      return { success: false, message: "음악을 처리하는 중 오류가 발생했습니다." };
    }
  }

  /**
   * 첫 번째 트랙이 재생되는 동안 남은 재생목록 트랙이 추가되었음을 메시지로 표시
   */
  async showPlaylistAdditionMessage(player, queued, sourceLabel, insertFirst = false, notice = {}) {
    const messageText = this.createQueueAdditionMessage(queued, sourceLabel, insertFirst, notice);

    // 진입점의 응답이 아니라 항상 텍스트 채널로 — 채널이 없는 경로(대시보드)는 생략
    if (!player.textChannel || typeof player.textChannel.send !== "function") return;

    let infoMessage;
    try {
      infoMessage = await player.textChannel.send({ content: messageText });

      // 10초 후 정보 메시지 삭제
      setTimeout(async () => {
        try {
          await infoMessage.delete();
        } catch (error) {
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
  async createNewMusicEmbed(player, track, requester, responder = silentResponder) {
    // 보낼 채널이 없으면 재생은 계속하되 임베드만 건너뛴다
    if (!player.textChannel || typeof player.textChannel.send !== "function") {
      return { success: true, message: "Now playing", isNewEmbed: false };
    }

    const { message, webhook } = await this._sendNowPlaying(player, track);
    player.nowPlayingWebhook = webhook;

    // 진입점이 띄운 "검색 중…" 자리표시자 제거 — 채널에 중복/정지 메시지를 남기지 않는다
    await responder.dismissPlaceholder();

    player.nowPlayingMessage = message;
    player.requesterId = requester?.id ?? null;

    this.startProgressUpdate(player);

    return { success: true, message: "Now playing", isNewEmbed: true };
  }

  /**
   * 음악 재생 중 곡이 대기열에 추가되는 경우를 처리합니다.
   */
  async handleQueueAddition(player, tracks, responder, sourceLabel, insertFirst = false, notice = {}) {
    // 기존 임베드 갱신
    if (player.nowPlayingMessage && player.currentTrack) {
      await this.updateNowPlayingEmbed(player);
    }

    await responder.notifyQueued(this.createQueueAdditionMessage(tracks, sourceLabel, insertFirst, notice));

    return { success: true, message: "Added to queue", isNewEmbed: false, dropped: notice.dropped ?? 0, queueLimited: Boolean(notice.queueLimited) };
  }

  /**
   * 현재 재생 메시지를 채널에 보냅니다. 참조 갱신은 호출자 몫.
   *
   * 지속되는 now-playing 메시지는 상호작용 유무와 무관하게 항상 채널 웹훅(실패 시 일반 채널 메시지)으로 보낸다.
   * 상호작용 응답(@original)으로 보내면 이후 편집이 상호작용 토큰을 사용하는데, 이 토큰은 생성 15분 뒤 만료되어
   * 장시간 세션에서 진행바/트랙 갱신이 50027(Invalid Webhook Token)로 실패한다. 웹훅/봇 토큰은 만료되지 않는다.
   * (부수 효과로 메시지에 webhook_id가 붙어 CV2 이모지 링크 렌더링도 올바르게 유지된다.)
   */
  async _sendNowPlaying(player, track) {
    const container = await this.createNowPlayingContainer(player, track);
    const jumpToRow = await this.createJumpToRow(player);
    const components = jumpToRow ? [container, jumpToRow] : [container];
    const payload = { components, flags: MessageFlags.IsComponentsV2 };

    const webhook = await this.getOrCreateWebhook(player.textChannel);
    if (!webhook) return { message: await player.textChannel.send(payload), webhook: null };

    const message = await webhook.send({
      ...payload,
      username: this.client.user.displayName || this.client.user.username,
      avatarURL: this.client.user.displayAvatarURL(),
    });
    return { message, webhook };
  }

  /** 현재 재생 메시지를 지웁니다. 이미 없거나 권한이 없으면 그냥 넘어갑니다. */
  async _removeNowPlaying(channel, webhook, messageId) {
    if (!messageId) return;
    try {
      if (webhook) await webhook.deleteMessage(messageId);
      else await channel?.messages?.delete(messageId);
    } catch {
      /* 이미 지워졌거나 지울 권한이 없음 */
    }
  }

  /**
   * 현재 재생 메시지를 채널 맨 아래에 다시 올립니다 (기존 것은 제거).
   * 사용자가 지웠을 때의 자가 복구와, 전용 채널에서 묻혔을 때의 재고정이 같은 경로를 씁니다.
   *
   * 서버당 한 번만 — 5초 갱신과 명령·버튼 경로가 동시에 들어온다.
   * 보내는 사이에 재생이 끝나거나 다른 경로가 새 메시지를 올렸으면 방금 보낸 것을 도로 지운다.
   */
  async _repostNowPlaying(player, reason) {
    const guildId = player.guild?.id;
    if (!guildId || this.reposting.has(guildId)) return;
    if (!player.currentTrack || typeof player.textChannel?.send !== "function") return;

    this.reposting.add(guildId);
    const previous = player.nowPlayingMessage;
    const previousWebhook = player.nowPlayingWebhook;
    try {
      const { message, webhook } = await this._sendNowPlaying(player, player.currentTrack);

      if (player.nowPlayingMessage !== previous || !player.currentTrack) {
        await this._removeNowPlaying(player.textChannel, webhook, message?.id);
        return;
      }

      player.nowPlayingMessage = message;
      player.nowPlayingWebhook = webhook;
      await this._removeNowPlaying(player.textChannel, previousWebhook, previous?.id);
      log.info({ tags: ["recovered"] }, `재생 중 임베드 다시 올림: ${reason}`);
    } catch (error) {
      // 다시 올리지 못하면 참조를 버린다 — 5초마다 같은 실패를 반복하면 그게 도배다
      player.nowPlayingMessage = null;
      this.stopProgressUpdate(guildId);
      log.error("재생 중 임베드 다시 올리기 실패:", error?.message || error);
    } finally {
      this.reposting.delete(guildId);
    }
  }

  /**
   * 전용 채널에서 현재 재생 메시지가 다른 메시지 밑에 묻혔는지 봅니다.
   *
   * 채널 캐시만 읽는다(추가 API 호출 없음) — 삭제된 메시지는 캐시에서도 빠지므로
   * 잠깐 떴다 사라지는 안내는 세는 대상이 아니다. 전용 채널이 아니면 건드리지 않는다.
   */
  async _isBuried(player, now = Date.now()) {
    const channel = player.textChannel;
    const currentId = player.nowPlayingMessage?.id;
    if (!currentId || !channel?.messages?.cache) return false;
    if (!player.guild?.id) return false;
    if ((await GuildSettingsManager.getBotChannel(player.guild.id)) !== channel.id) return false;

    const cutoff = now - PIN_SETTLE_MS;
    return channel.messages.cache.some((m) => m.createdTimestamp <= cutoff && BigInt(m.id) > BigInt(currentId));
  }

  /**
   * 현재 재생 컨테이너를 빌드합니다 (Components v2).
   */
  async createNowPlayingContainer(player, track, buttonsDisabled = false) {
    const nowPlayingTitle = "🎵 현재 재생 중";

    const currentMs = player.getCurrentTime ? player.getCurrentTime() : 0;
    const currentSec = Math.floor(currentMs / 1000);
    const totalSec = track.duration || 0;
    const progressBar = this.buildProgressBar(currentSec, totalSec);

    const artistValue = track.artist || "-";
    const platformValue = track.platform ? track.platform.charAt(0).toUpperCase() + track.platform.slice(1) : "-";

    const artistLine = artistValue && artistValue !== "-" ? `\n-# 👤 ${escapeMd(artistValue)}` : "";
    // 제목은 이스케이프하지 않는다 — 링크 라벨 안에서는 백슬래시가 그대로 노출된다(mentions.js).
    const linkText = `### ${nowPlayingTitle}\n**[${track.title}](${track.url})**${artistLine}`;

    // Section은 액세서리(썸네일/버튼)가 없으면 전송 시 검증에서 거부된다.
    // 직접 링크는 썸네일이 없으므로(임의 URL이라 앨범아트를 알 수 없다) 텍스트만 넣는다.
    const titleComponent = track.thumbnail ? new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText)).setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail)) : null;

    // 상태 줄 (일시정지 / 대기열 수)
    const statusParts = [];
    if (player.paused) {
      if (player.pauseReasons?.has("mute")) statusParts.push("🔇 뮤트됨");
      else if (player.pauseReasons?.has("alone")) statusParts.push("⏳ 혼자 남음");
      else statusParts.push("⏸️ 일시정지");
    }
    if (player.queue.length > 0) {
      statusParts.push(`${player.queue.length}개의 노래 대기 중`);
    }
    if (track.sponsor?.skipSegments?.length) {
      statusParts.push(`건너 뛸 구간 ${track.sponsor.skipSegments.length}개`);
    }

    const container = new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor));
    if (titleComponent) container.addSectionComponents(titleComponent);
    else container.addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar));

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
  buildProgressBar(currentSec, totalSec) {
    const BAR_LENGTH = 16;
    const currentStr = this.formatDuration(currentSec);
    const totalStr = this.formatDuration(totalSec);

    if (!totalSec || totalSec === 0) {
      return `\`${currentStr}\` ●${"▬".repeat(BAR_LENGTH)} \`${totalStr}\``;
    }

    const progress = Math.min(currentSec / totalSec, 1);
    const filledCount = Math.round(progress * BAR_LENGTH);
    const bar = "▬".repeat(filledCount) + "●" + "▬".repeat(BAR_LENGTH - filledCount);
    return `\`${currentStr}\` ${bar} \`${totalStr}\``;
  }

  /**
   * 현재 재생 임베드를 제자리에서 갱신합니다.
   */
  async updateNowPlayingEmbed(player) {
    if (player?.guild?.id) DashboardEvents.notify(player.guild.id); // 대시보드 SSE 넛지 (Discord 임베드 유무와 무관하게 발신)
    if (!player.nowPlayingMessage || !player.currentTrack) return;
    if (this.reposting.has(player.guild?.id)) return; // 다시 올리는 중 — 그쪽이 최신 내용으로 보낸다

    try {
      const container = await this.createNowPlayingContainer(player, player.currentTrack);
      const jumpToRow = await this.createJumpToRow(player);
      const components = jumpToRow ? [container, jumpToRow] : [container];
      if (player.nowPlayingWebhook) {
        await player.nowPlayingWebhook.editMessage(player.nowPlayingMessage.id, {
          components,
          flags: MessageFlags.IsComponentsV2,
        });
      } else {
        await player.nowPlayingMessage.edit({
          components,
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      // 편집 대상이 없어졌다 — 참조를 붙든 채 5초마다 같은 오류를 찍는 대신 다시 올린다
      if (isGone(error)) {
        if (error.code === UNKNOWN_WEBHOOK && player.textChannel?.id) {
          this.deleteWebhookCache(player.textChannel.id);
          player.nowPlayingWebhook = null;
        }
        await this._repostNowPlaying(player, "메시지가 지워짐");
        return;
      }
      log.error("재생 중 임베드 갱신 실패:", error);
    }
  }

  /**
   * 모든 음악이 끝났을 때 호출됩니다.
   */
  async handlePlaybackEnd(player) {
    if (player?.guild?.id) DashboardEvents.notify(player.guild.id); // 대시보드 SSE 넛지 (종료/정지)
    this.stopProgressUpdate(player.guild?.id);

    // 버튼 비활성화
    if (player.nowPlayingMessage && player.currentTrack) {
      try {
        const container = await this.createNowPlayingContainer(player, player.currentTrack, true);
        if (player.nowPlayingWebhook) {
          await player.nowPlayingWebhook.editMessage(player.nowPlayingMessage.id, {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        } else {
          await player.nowPlayingMessage.edit({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (error) {
        // 이미 지워진 메시지의 버튼을 못 껐다는 것은 알릴 일이 아니다
        if (!isGone(error)) log.error("버튼 비활성화 실패:", error);
      }
    }

    let endEmbed = null;

    try {
      endEmbed = new EmbedBuilder().setTitle("🎵 음악 종료됨").setDescription("모든 노래가 재생되었습니다! `/play` 명령을 사용하여 새 트랙을 추가하세요.").setColor("#FF6B6B").setTimestamp();
    } catch (error) {
      log.error("재생 종료 임베드 준비 실패:", error);
    }

    if (!endEmbed) {
      endEmbed = new EmbedBuilder().setDescription("🎵 음악 종료됨").setColor("#FF6B6B").setTimestamp();
    }

    const textChannel = player.textChannel;
    if (textChannel && typeof textChannel.send === "function") {
      try {
        await textChannel.send({ embeds: [endEmbed] });
      } catch (error) {
        // 채널을 사용할 수 없거나 권한이 없을 때 오류 억제
      }
    }

    // 플레이어 정리
    trackState.setCurrent(player, null);
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
  }

  /**
   * 제어 버튼을 생성합니다.
   */
  async createControlButtons(player, disabled = false) {
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
      .setDisabled(disabled || (player.queue.length === 0 && player.loop !== "track")); // 한곡 반복 = 재시작이라 대기열 비어도 활성

    const stopButton = new ButtonBuilder().setCustomId(`music_stop:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Danger).setEmoji("⏹️").setDisabled(disabled);

    const volumeButton = new ButtonBuilder().setCustomId(`music_volume:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("🔊").setDisabled(disabled);

    // Row 2: 셔플(아이콘만) + 반복 + 대기열 + 자동재생
    const shuffleButton = new ButtonBuilder().setCustomId(`music_shuffle:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("🔀").setDisabled(disabled);

    // 반복 버튼 — 꺼짐 → 트랙 → 대기열 순환
    let loopLabel, loopEmoji, loopStyle;
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

    const queueButton = new ButtonBuilder().setCustomId(`music_queue:${requesterId}:${sessionId}`).setLabel("대기열").setStyle(ButtonStyle.Primary).setEmoji("📋").setDisabled(false);

    const autoplayButton = new ButtonBuilder()
      .setCustomId(`music_autoplay:${requesterId}:${sessionId}`)
      .setLabel("자동재생")
      .setStyle(player.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🎲")
      .setDisabled(disabled);

    // SponsorBlock 하이라이트 점프 — 항상 표시, 지점 없으면 비활성(스킵 버튼처럼 UI 일관성). 셔플 왼쪽.
    const highlightAt = player.currentTrack?.sponsor?.highlightAt;
    const hasHighlight = highlightAt !== null && highlightAt !== undefined;
    const highlightButton = new ButtonBuilder()
      .setCustomId(`music_highlight:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💡")
      .setDisabled(disabled || !hasHighlight);

    const row = new ActionRowBuilder().addComponents(previousButton, pauseButton, skipButton, stopButton, volumeButton);
    const row2 = new ActionRowBuilder().addComponents(highlightButton, shuffleButton, loopButton, queueButton, autoplayButton);

    return [row, row2];
  }

  /**
   * 대기열 이동 선택 메뉴를 독립 ActionRow로 빌드합니다.
   * Discord가 Container 안에 중첩된 선택 메뉴 ActionRow를 무시하므로 최상위 components 배열에 배치해야 합니다 (Container 안이 아님).
   * 대기열이 비었거나 플레이어 상태가 없으면 null을 반환합니다.
   */
  async createJumpToRow(player) {
    if (!player.requesterId || !player.sessionId || player.queue.length === 0) return null;

    const tracks = player.queue.slice(0, 25);
    const options = tracks.map((track, i) => {
      const label = `${i + 1}. ${track.title}`.slice(0, 100);
      const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i));
      if (track.artist) opt.setDescription(track.artist.slice(0, 100));
      return opt;
    });

    const placeholder = "⏭ 이 곡으로 바로 이동...";
    const select = new StringSelectMenuBuilder().setCustomId(`music_jumpto:${player.requesterId}:${player.sessionId}`).setPlaceholder(placeholder).addOptions(options);

    return new ActionRowBuilder().addComponents(select);
  }

  /**
   * 대기열 추가 메시지를 빌드합니다.
   * @param {string|null} sourceLabel 여러 곡을 담은 출처의 표시 이름(재생목록·앨범 등). 없으면 한 곡 안내
   */
  // notice: { dropped 상한으로 뺀 곡 수, total 받은 것보다 많은 전체 곡 수, queueLimited 자리가 모자라 덜 받음 }
  createQueueAdditionMessage(tracks, sourceLabel, insertFirst = false, { dropped = 0, total = null, queueLimited = false } = {}) {
    let text;
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
   * 초 단위 길이를 H:MM:SS 또는 M:SS 형식으로 변환합니다. (공용 구현: src/utils.js)
   */
  formatDuration(seconds) {
    return formatDuration(seconds);
  }

  /**
   * 플랫폼 이름에 해당하는 이모지를 반환합니다.
   */
  getPlatformEmoji(platform) {
    const emojis = {
      youtube: "🔴",
      spotify: "🟢",
      soundcloud: "🟠",
      direct: "🔗",
    };
    return emojis[platform] || "🎵";
  }

  /**
   * 진행 바를 새로고침하는 5초 간격 타이머를 시작합니다.
   */
  startProgressUpdate(player) {
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
  stopProgressUpdate(guildId) {
    const id = this.updateIntervals.get(guildId);
    if (id) {
      clearInterval(id);
      this.updateIntervals.delete(guildId);
    }
  }
}

module.exports = MusicEmbedManager;
