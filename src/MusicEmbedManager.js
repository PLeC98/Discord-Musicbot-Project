const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MessageFlags, SeparatorSpacingSize, resolveColor, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, WebhookClient } = require("discord.js");
const config = require("../config");

class MusicEmbedManager {
  constructor(client) {
    this.client = client;
    this.processingQueue = new Map(); // guildId -> Promise
    this.updateIntervals = new Map(); // guildId -> intervalId
    this.webhookCache = new Map(); // channelId -> WebhookClient
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
   * Preloads tracks in the queue sequentially to prevent buffering
   */
  async sequentialPreload(player, tracks) {
    // Only preload the next few tracks — preloading everything at once hammers YouTube
    const PRELOAD_AHEAD = 5;
    const toPreload = tracks.slice(0, PRELOAD_AHEAD);

    for (const track of toPreload) {
      // Skip if already preloaded or currently being preloaded
      if (player.preloadedStreams.has(track.url) || player.preloadingQueue.includes(track.url)) {
        continue;
      }

      try {
        await player.preloadTrack(track);
        // 3-second gap between preloads to avoid YouTube rate-limiting
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (err) {
        console.error(`❌ Preload error for ${track.title}:`, err.message);
        // Continue even on error
      }
    }
  }

  /**
   * Processes music data and sends/updates the appropriate embed
   */
  async handleMusicData(guildId, trackData, member, interaction = null) {
    // Prevent race conditions — only one operation per guild at a time
    if (this.processingQueue.has(guildId)) {
      await this.processingQueue.get(guildId);
    }

    const processingPromise = this._processMusic(guildId, trackData, member, interaction);
    this.processingQueue.set(guildId, processingPromise);

    try {
      const result = await processingPromise;
      return result;
    } finally {
      this.processingQueue.delete(guildId);
    }
  }

  async _processMusic(guildId, trackData, member, interaction) {
    const player = this.client.players.get(guildId);
    if (!player) return { success: false, message: "No player found" };

    const wasPlayingBefore = player.currentTrack !== null;
    const isPlaylist = trackData.isPlaylist || false;
    const insertFirst = trackData.insertFirst || false;
    const tracks = trackData.tracks;

    try {
      let firstTrackResult = null;
      const wasIdle = !player.currentTrack && player.queue.length === 0;
      const tracksToQueue = [];

      // Add all tracks to player (triggers preload)
      for (let i = 0; i < tracks.length; i++) {
        const track = { ...tracks[i] };
        track.requestedBy = member;
        track.addedAt = Date.now();

        // First track and player is idle — start playback
        if (i === 0 && wasIdle) {
          player.currentTrack = track;

          // Connect to voice channel and start playing
          let playbackStarted = false;
          try {
            if (!player.connection) {
              await player.connect();
            }
            await player.play();
            playbackStarted = true;
          } catch (playError) {
            console.error("Error in play process:", playError);
            // On error, push track back to queue
            player.currentTrack = null;
            tracksToQueue.push(track);
          }

          // UI failure must not corrupt playback state — if the embed cannot
          // be created (e.g. CV2 edit restriction), playback continues anyway
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

      // Insert collected tracks at front or back of queue
      if (tracksToQueue.length > 0) {
        if (insertFirst) {
          player.queue.unshift(...tracksToQueue);
          // Honor front placement on the next transition even when shuffle is on
          if (player.currentTrack) player.nextFromFront = true;
        } else {
          player.queue.push(...tracksToQueue);
        }
      }

      // Trigger sequential preload for queued tracks to prevent buffering
      this.sequentialPreload(player, player.queue.slice()).catch((err) => console.error("❌ Sequential preload error:", err.message));

      // First track started playing and there are more tracks in the playlist
      if (firstTrackResult && tracks.length > 1) {
        // Show message that remaining playlist tracks were added to queue
        await this.showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist, insertFirst);
        // Queue updated — refresh embed
        await this.updateNowPlayingEmbed(player);
        return firstTrackResult;
      }

      // Only added to queue (music was already playing)
      if (wasPlayingBefore || (!firstTrackResult && tracks.length > 0)) {
        return await this.handleQueueAddition(player, tracks, member, interaction, isPlaylist, insertFirst);
      }

      // Single track started playing
      if (firstTrackResult) {
        return firstTrackResult;
      }

      return { success: true, message: "Track processed successfully" };
    } catch (error) {
      return { success: false, message: "Error processing music" };
    }
  }

  /**
   * Shows a message when remaining playlist tracks are added while the first track plays
   */
  async showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist, insertFirst = false) {
    // Send info for remaining tracks (excluding the first)
    const remainingTracks = tracks.slice(1);
    const messageText = this.createQueueAdditionMessage(remainingTracks, member.guild.id, isPlaylist, insertFirst);

    // Send to text channel (not via interaction)
    let infoMessage;
    try {
      infoMessage = await player.textChannel.send({ content: messageText });

      // Delete info message after 10 seconds
      setTimeout(async () => {
        try {
          await infoMessage.delete();
        } catch (error) {
          // Message may have already been deleted
        }
      }, 10000);
    } catch (error) {
      console.error("Error sending playlist addition message:", error);
    }
  }

  /**
   * Creates a new music embed (when nothing is currently playing)
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
      // Use webhook so the message has webhook_id — required for emoji links in CV2 text displays to render correctly
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
   * Handles the case when a song is added to the queue while music is playing
   */
  async handleQueueAddition(player, tracks, member, interaction, isPlaylist, insertFirst = false) {
    // Update existing embed
    if (player.nowPlayingMessage && player.currentTrack) {
      await this.updateNowPlayingEmbed(player);
    }

    // Send info message
    const messageText = this.createQueueAdditionMessage(tracks, member.guild.id, isPlaylist, insertFirst);

    let infoMessage;
    if (interaction) {
      if (interaction.deferred || interaction.replied) {
        // The initial reply from /play and /playfirst is a CV2 container —
        // CV2 messages reject the `content` field, so edit with a container
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

    // Delete info message after 10 seconds
    setTimeout(async () => {
      try {
        await infoMessage.delete();
      } catch (error) {
        // Message may have already been deleted
      }
    }, 10000);

    return { success: true, message: "Added to queue", isNewEmbed: false };
  }

  /**
   * Builds the now playing container (Components v2)
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

    // Status line (pause / queue count)
    const statusParts = [];
    if (player.paused) {
      if (player.pauseReasons?.has("mute")) statusParts.push("🔇 뮤트됨");
      else if (player.pauseReasons?.has("alone")) statusParts.push("⏳ 혼자 남음");
      else statusParts.push("⏸️ 일시정지");
    }
    if (player.queue.length > 0) {
      statusParts.push(`대기열에 ${player.queue.length}개의 노래가 더 있습니다`);
    }

    const container = new ContainerBuilder().setAccentColor(resolveColor(config.bot.embedColor)).addSectionComponents(section).addTextDisplayComponents(new TextDisplayBuilder().setContent(progressBar));

    if (statusParts.length > 0) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${statusParts.join(" • ")}`));
    }

    // Separator + control buttons
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const buttons = await this.createControlButtons(player, buttonsDisabled);
    for (const row of buttons) {
      container.addActionRowComponents(row);
    }

    // Separator + dashboard link
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🔗 [대시보드](${config.dashboard.url})  |  🖥️ ${platformValue}`));

    return container;
  }

  /**
   * Builds the progress bar string
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
   * Updates the now playing embed in place
   */
  async updateNowPlayingEmbed(player) {
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
   * Called when a track ends
   */
  async handleTrackEnd(player) {
    if (player.queue.length > 0) {
      // Move to next track
      const nextTrack = player.queue.shift();
      player.currentTrack = nextTrack;

      await player.play();
      await this.updateNowPlayingEmbed(player);
      this.startProgressUpdate(player);
    } else {
      // All tracks finished
      await this.handlePlaybackEnd(player);
    }
  }

  /**
   * Called when all music has finished
   */
  async handlePlaybackEnd(player) {
    this.stopProgressUpdate(player.guild?.id);

    // Disable buttons
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
    const guildId = player.guild?.id;

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
        // Suppress errors when channel is unavailable or permissions are missing
      }
    }

    // Clean up player
    player.currentTrack = null;
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;
  }

  /**
   * Creates control buttons
   */
  async createControlButtons(player, disabled = false) {
    const sessionId = player.sessionId;
    const requesterId = player.requesterId;

    const shuffleLabel = "셔플";
    const queueLabel = "대기열";

    // Icon-only: pause/resume, skip, stop, volume
    const pauseButton = new ButtonBuilder()
      .setCustomId(`music_pause:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setDisabled(disabled);

    const skipButton = new ButtonBuilder()
      .setCustomId(`music_skip:${requesterId}:${sessionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setDisabled(disabled || player.queue.length === 0);

    const stopButton = new ButtonBuilder().setCustomId(`music_stop:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Danger).setEmoji("⏹️").setDisabled(disabled);

    const volumeButton = new ButtonBuilder().setCustomId(`music_volume:${requesterId}:${sessionId}`).setStyle(ButtonStyle.Secondary).setEmoji("🔊").setDisabled(disabled);

    // Icon + label: shuffle
    const shuffleButton = new ButtonBuilder()
      .setCustomId(`music_shuffle:${requesterId}:${sessionId}`)
      .setLabel(shuffleLabel)
      .setStyle(player.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔀")
      .setDisabled(disabled);

    // Loop button — cycles off → track → queue (icon + label)
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

    // Autoplay button (icon + label)
    let autoplayLabel, autoplayStyle;
    if (player.autoplay) {
      autoplayLabel = "자동 재생: 켜짐";
      autoplayStyle = ButtonStyle.Success;
    } else {
      autoplayLabel = "자동 재생: 꺼짐";
      autoplayStyle = ButtonStyle.Secondary;
    }

    const autoplayButton = new ButtonBuilder().setCustomId(`music_autoplay:${requesterId}:${sessionId}`).setLabel(autoplayLabel).setStyle(autoplayStyle).setEmoji("🎲").setDisabled(disabled);

    const queueButton = new ButtonBuilder().setCustomId(`music_queue:${requesterId}:${sessionId}`).setLabel(queueLabel).setStyle(ButtonStyle.Primary).setEmoji("📋").setDisabled(false);

    // Row 1 (5): pause + skip + stop + shuffle + loop
    const row = new ActionRowBuilder().addComponents(pauseButton, skipButton, stopButton, shuffleButton, loopButton);

    // Row 2 (3): volume + queue + autoplay
    const row2 = new ActionRowBuilder().addComponents(volumeButton, queueButton, autoplayButton);

    return [row, row2];
  }

  /**
   * Builds the jump-to select menu as a standalone ActionRow.
   * Must be placed at the top-level components array (NOT inside the Container)
   * because Discord ignores select-menu ActionRows that are nested inside Containers.
   * Returns null when the queue is empty or player state is missing.
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
   * Builds the queue addition message
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
   * Formats duration seconds into H:MM:SS or M:SS
   */
  formatDuration(seconds) {
    if (!seconds || seconds === 0) return "0:00";

    const totalSeconds = Math.floor(Number(seconds) || 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    }
  }

  /**
   * Returns the platform emoji for a given platform name
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
   * Starts a 5-second interval to refresh the progress bar
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
   * Stops the progress update interval for a guild
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
