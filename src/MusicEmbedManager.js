const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient } = require("discord.js");
const config = require("../config");
const { formatDuration } = require("./utils");
const DashboardEvents = require("./DashboardEvents");

class MusicEmbedManager {
  constructor(client) {
    this.client = client;
    this.processingQueue = new Map(); // guildId -> Promise 매핑
    this.updateIntervals = new Map(); // guildId -> intervalId 매핑
    this.webhookCache = new Map(); // channelId -> WebhookClient 매핑
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
      const client = new WebhookClient({ id: webhook.id, token: webhook.token });
      this.webhookCache.set(channel.id, client);
      return client;
    } catch (error) {
      console.error("Webhook get/create failed:", error.message);
      return null;
    }
  }

  createSearchingContainer(msg) {
    return new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addTextDisplayComponents(new TextDisplayBuilder().setContent(msg));
  }

  createErrorContainer(msg) {
    return new ContainerBuilder().setAccentColor(resolveColor("#FF0000")).addTextDisplayComponents(new TextDisplayBuilder().setContent(`❌ ${msg}`));
  }

  /**
   * 버퍼링 방지를 위해 대기열의 트랙을 순차적으로 사전 로드합니다.
   */
  async sequentialPreload(player, tracks) {
    const toPreload = tracks.slice(0, config.preload.ahead);

    for (const track of toPreload) {
      // 이미 사전 로드되었거나 현재 사전 로드 중이면 건너뜀
      if (player.preloadedStreams.has(track.url) || player.preloadingQueue.includes(track.url)) {
        continue;
      }

      try {
        await player.preloadTrack(track);
        await new Promise((resolve) => setTimeout(resolve, config.preload.gapMs));
      } catch (err) {
        console.error(`❌ Preload error for ${track.title}:`, err.message);
        // 오류가 나도 계속 진행
      }
    }
  }

  /**
   * 음악 데이터를 처리하고 적절한 임베드를 전송/갱신합니다.
   *
   * 길드당 한 번에 하나의 작업만 — Promise tail 체인 방식.
   * "기다렸다가 등록"(await 후 set)은 대기와 등록 사이에 끼어든 요청이 락을 놓치고,
   * 앞 작업의 finally가 뒤 작업의 Map 항목을 지우는 경쟁이 있었다(A/B/C 동시 시나리오).
   * 여기서는 get+set이 동기(사이에 await 없음)라 끼어들 틈이 없고, 정리도 자기 항목일 때만 한다.
   */
  handleMusicData(guildId, trackData, member, interaction = null) {
    const tail = this.processingQueue.get(guildId) || Promise.resolve();
    // 앞 작업의 실패가 뒤 작업까지 실패시키면 안 됨 — 각 작업의 결과/오류는 자기 호출자에게만 전달
    const processingPromise = tail.catch(() => {}).then(() => this._processMusic(guildId, trackData, member, interaction));
    this.processingQueue.set(guildId, processingPromise);

    return processingPromise.finally(() => {
      if (this.processingQueue.get(guildId) === processingPromise) {
        this.processingQueue.delete(guildId);
      }
    });
  }

  async _processMusic(guildId, trackData, member, interaction) {
    const player = this.client.players.get(guildId);
    if (!player) return { success: false, message: "음악 플레이어를 찾을 수 없습니다." };

    const wasPlayingBefore = player.currentTrack !== null;
    const isPlaylist = trackData.isPlaylist || false;
    const insertFirst = trackData.insertFirst || false;
    const tracks = trackData.tracks;

    try {
      let firstTrackResult = null;
      const wasIdle = !player.currentTrack && player.queue.length === 0;
      const tracksToQueue = [];

      // 모든 트랙을 플레이어에 추가 (사전 로드 트리거)
      for (let i = 0; i < tracks.length; i++) {
        const track = { ...tracks[i] };
        track.requestedBy = member;
        track.addedAt = Date.now();

        // 첫 번째 트랙이고 플레이어가 유휴 상태이면 재생 시작
        if (i === 0 && wasIdle) {
          player.currentTrack = track;

          // 음성 채널에 연결하고 재생 시작
          let playbackStarted = false;
          try {
            if (!player.connection) {
              await player.connect();
            }
            await player.play();
            playbackStarted = true;
          } catch (playError) {
            console.error("Error in play process:", playError);
            // 오류 발생 시 트랙을 대기열에 다시 넣음
            player.currentTrack = null;
            tracksToQueue.push(track);
          }

          // UI 실패가 재생 상태를 망가뜨리면 안 됨 — 임베드를 생성할 수 없어도(예: CV2 수정 제한) 재생은 계속 진행
          if (playbackStarted) {
            try {
              firstTrackResult = await this.createNewMusicEmbed(player, track, member, interaction);
            } catch (embedError) {
              console.error("Error creating now playing embed:", embedError);
              firstTrackResult = { success: true, message: "Now playing", isNewEmbed: false };
            }
          }
        } else {
          tracksToQueue.push(track);
        }
      }

      // 수집한 트랙을 대기열 앞이나 뒤에 삽입
      if (tracksToQueue.length > 0) {
        if (insertFirst) {
          player.queue.unshift(...tracksToQueue);
          // 셔플이 켜져 있어도 다음 전환에서 앞쪽 배치를 존중
          if (player.currentTrack) player.nextFromFront = true;
        } else {
          player.queue.push(...tracksToQueue);
        }
      }

      // 버퍼링 방지를 위해 대기열 트랙의 순차 사전 로드 트리거
      this.sequentialPreload(player, player.queue.slice()).catch((err) => console.error("❌ Sequential preload error:", err.message));

      // 첫 번째 트랙이 재생을 시작했고 재생목록에 남은 트랙이 있음
      if (firstTrackResult && tracks.length > 1) {
        // 남은 재생목록 트랙이 대기열에 추가되었음을 메시지로 표시
        await this.showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist, insertFirst);
        // 대기열 갱신 — 임베드 새로고침
        await this.updateNowPlayingEmbed(player);
        return firstTrackResult;
      }

      // 대기열에만 추가됨 (이미 음악 재생 중)
      if (wasPlayingBefore || (!firstTrackResult && tracks.length > 0)) {
        return await this.handleQueueAddition(player, tracks, member, interaction, isPlaylist, insertFirst);
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
  async showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist, insertFirst = false) {
    // 첫 번째를 제외한 남은 트랙 정보 전송
    const remainingTracks = tracks.slice(1);
    const messageText = this.createQueueAdditionMessage(remainingTracks, member.guild.id, isPlaylist, insertFirst);

    // 상호작용이 아닌 텍스트 채널로 전송
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
      console.error("Error sending playlist addition message:", error);
    }
  }

  /**
   * 새 음악 임베드 생성 (현재 재생 중인 곡이 없을 때)
   */
  async createNewMusicEmbed(player, track, member, interaction) {
    const container = await this.createNowPlayingContainer(player, track, member.guild.id);
    const jumpToRow = await this.createJumpToRow(player);
    const components = jumpToRow ? [container, jumpToRow] : [container];
    const payload = { components, flags: MessageFlags.IsComponentsV2 };

    let message;
    if (interaction) {
      if (interaction.deferred || interaction.replied) {
        message = await interaction.editReply({ content: null, ...payload });
      } else {
        message = await interaction.reply(payload);
      }
    } else {
      // 메시지에 webhook_id가 붙도록 웹훅 사용 — CV2 텍스트 표시에서 이모지 링크가 올바르게 렌더링되는 데 필요
      const webhook = await this.getOrCreateWebhook(player.textChannel);
      if (webhook) {
        message = await webhook.send({
          ...payload,
          username: this.client.user.displayName || this.client.user.username,
          avatarURL: this.client.user.displayAvatarURL(),
        });
        player.nowPlayingWebhook = webhook;
      } else {
        message = await player.textChannel.send(payload);
        player.nowPlayingWebhook = null;
      }
    }

    player.nowPlayingMessage = message;
    player.requesterId = member.id;

    this.startProgressUpdate(player);

    return { success: true, message: "Now playing", isNewEmbed: true };
  }

  /**
   * 음악 재생 중 곡이 대기열에 추가되는 경우를 처리합니다.
   */
  async handleQueueAddition(player, tracks, member, interaction, isPlaylist, insertFirst = false) {
    // 기존 임베드 갱신
    if (player.nowPlayingMessage && player.currentTrack) {
      await this.updateNowPlayingEmbed(player);
    }

    // 정보 메시지 전송
    const messageText = this.createQueueAdditionMessage(tracks, member.guild.id, isPlaylist, insertFirst);

    let infoMessage;
    if (interaction) {
      if (interaction.deferred || interaction.replied) {
        // /play 및 /playfirst의 초기 응답은 CV2 컨테이너이므로 — CV2 메시지는 `content` 필드를 거부하므로 컨테이너로 수정
        infoMessage = await interaction.editReply({
          components: [this.createSearchingContainer(messageText)],
          flags: MessageFlags.IsComponentsV2,
        });
      } else {
        infoMessage = await interaction.reply({ content: messageText, flags: [1 << 6] });
      }
    } else {
      infoMessage = await player.textChannel.send({ content: messageText });
    }

    // 10초 후 정보 메시지 삭제
    setTimeout(async () => {
      try {
        await infoMessage.delete();
      } catch (error) {
        // 메시지가 이미 삭제되었을 수 있음
      }
    }, 10000);

    return { success: true, message: "Added to queue", isNewEmbed: false };
  }

  /**
   * 현재 재생 컨테이너를 빌드합니다 (Components v2).
   */
  async createNowPlayingContainer(player, track, guildId, buttonsDisabled = false) {
    const nowPlayingTitle = "🎵 현재 재생 중";

    const currentMs = player.getCurrentTime ? player.getCurrentTime() : 0;
    const currentSec = Math.floor(currentMs / 1000);
    const totalSec = track.duration || 0;
    const progressBar = this.buildProgressBar(currentSec, totalSec);

    const artistValue = track.artist || "-";
    const platformValue = track.platform ? track.platform.charAt(0).toUpperCase() + track.platform.slice(1) : "-";

    const artistLine = artistValue && artistValue !== "-" ? `\n-# 👤 ${artistValue}` : "";
    const linkText = `### ${nowPlayingTitle}\n**[${track.title}](${track.url})**${artistLine}`;

    const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(linkText));
    if (track.thumbnail) {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
    }

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

    const container = new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addSectionComponents(section).addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar));

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

    try {
      const container = await this.createNowPlayingContainer(player, player.currentTrack, player.guild.id);
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
      console.error("Error updating now playing embed:", error);
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
        const container = await this.createNowPlayingContainer(player, player.currentTrack, player.guild?.id, true);
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
        console.error("Error disabling buttons:", error);
      }
    }

    let endEmbed = null;

    try {
      endEmbed = new EmbedBuilder().setTitle("🎵 음악 종료됨").setDescription("모든 노래가 재생되었습니다! `/play` 명령을 사용하여 새 트랙을 추가하세요.").setColor("#FF6B6B").setTimestamp();
    } catch (error) {
      console.error("Error preparing playback end embed:", error);
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
    player.currentTrack = null;
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
    const shuffleButton = new ButtonBuilder()
      .setCustomId(`music_shuffle:${requesterId}:${sessionId}`)
      .setStyle(player.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔀")
      .setDisabled(disabled);

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

    // SponsorBlock 하이라이트 점프 — 현재 곡에 하이라이트 지점이 있을 때만 노출(셔플 옆)
    const highlightAt = player.currentTrack?.sponsor?.highlightAt;
    const highlightButton = highlightAt !== null && highlightAt !== undefined ? new ButtonBuilder().setCustomId(`music_highlight:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("✨").setDisabled(disabled) : null;

    const row = new ActionRowBuilder().addComponents(previousButton, pauseButton, skipButton, stopButton, volumeButton);
    const row2Components = [shuffleButton];
    if (highlightButton) row2Components.push(highlightButton);
    row2Components.push(loopButton, queueButton, autoplayButton);
    const row2 = new ActionRowBuilder().addComponents(...row2Components);

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
   */
  createQueueAdditionMessage(tracks, guildId, isPlaylist, insertFirst = false) {
    if (isPlaylist) {
      return insertFirst ? `⏫ 재생목록의 ${tracks.length}개 노래가 대기열 맨 앞에 추가되었습니다!` : `✅ 재생목록의 ${tracks.length}개 노래가 대기열에 추가되었습니다!`;
    } else {
      const title = tracks[0]?.title || "알 수 없는 트랙";
      return insertFirst ? `⏫ **${title}**가 대기열 맨 앞에 추가되었습니다!` : `✅ **${title}**가 대기열에 추가되었습니다!`;
    }
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
        await this.updateNowPlayingEmbed(player);
      } catch {
        this.stopProgressUpdate(player.guild.id);
      }
    }, 5000);
    this.updateIntervals.set(player.guild.id, intervalId);
  }

  /**
   * 길드의 진행 갱신 타이머를 중지합니다.
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
