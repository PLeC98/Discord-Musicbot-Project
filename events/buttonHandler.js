const { Events, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const config = require("../config");
const MusicPlayer = require("../src/MusicPlayer");
const S = require("../src/strings");
const { checkControl, checkSkip, checkAdd } = require("../src/permissions");
const { formatDuration } = require("../src/utils");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;

    const client = interaction.client;
    const guild = interaction.guild;

    // DJ 역할 설정 UI 버튼은 전용 핸들러(djRoleConfigHandler.js)가 처리
    if (interaction.customId.startsWith("djrole:")) return;

    // 검색 버튼용 특수 제어
    if (interaction.customId.startsWith("search_")) {
      return await this.handleSearchInteraction(interaction, client);
    }

    // 도움말/시스템 새로고침 버튼 (음성 채널 불필요)
    if (interaction.customId === "help_refresh") {
      return await this.handleHelpRefresh(interaction);
    }
    if (interaction.customId === "system_refresh") {
      return await this.handleSystemRefresh(interaction);
    }

    // 음악 플레이어 가져오기 (음악 버튼은 현재 재생 패널에만 존재)
    // 재적/계층 검사는 각 핸들러의 check* 호출이 담당 — 조회(대기열)는 검사 없이 개방
    const player = client.players.get(guild.id);
    if (!player) {
      return await interaction.reply({
        content: S.ERR_NO_MUSIC,
        flags: [1 << 6],
      });
    }

    try {
      // 권한 확인과 세션 검증을 위해 커스텀 ID 파싱
      const customIdParts = interaction.customId.split(":");
      const [buttonType, requesterId, sessionId] = customIdParts;

      // 권한이 필요한 버튼의 세션 검증 (대기열 버튼은 제외)
      if (sessionId && player.sessionId && sessionId !== player.sessionId) {
        return await interaction.reply({
          content: S.ERR_SESSION_INVALID,
          flags: [1 << 6],
        });
      }

      switch (buttonType) {
        case "music_pause":
          await this.handlePause(interaction, player, requesterId);
          break;

        case "music_skip":
          await this.handleSkip(interaction, player, requesterId);
          break;

        case "music_stop":
          await this.handleStop(interaction, player, client, requesterId);
          break;

        case "music_queue":
          await this.handleQueue(interaction, player);
          break;

        case "music_shuffle":
          await this.handleShuffle(interaction, player, requesterId);
          break;

        case "music_volume":
          await this.handleVolumeModal(interaction, player, requesterId);
          break;

        case "music_loop":
          await this.handleLoop(interaction, player, requesterId);
          break;

        case "music_autoplay":
          await this.handleAutoplay(interaction, player, requesterId);
          break;

        case "music_previous":
          await this.handlePrevious(interaction, player);
          break;

        default:
          await interaction.reply({
            content: "❌ 알 수 없는 상호작용!",
            flags: [1 << 6],
          });
      }
    } catch (error) {
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: S.ERR_PROCESSING,
            flags: [1 << 6],
          });
        } catch (replyError) {}
      }
    }
  },

  async handlePause(interaction, player, _requesterId) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    if (!player.currentTrack) {
      return await interaction.reply({
        content: S.ERR_NO_SONG_PLAYING,
        flags: [1 << 6],
      });
    }

    let result, message, emoji;

    if (player.paused) {
      result = player.resume();
      message = "음악 재개됨";
      emoji = "▶️";
    } else {
      result = player.pause();
      message = "음악 일시정지됨";
      emoji = "⏸️";
    }

    if (result) {
      const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${message}`)
        .setDescription(`**[${player.currentTrack.title}](${player.currentTrack.url})** ${message}!`)
        .setColor(config.bot.embedColor)
        .setTimestamp()
        .addFields({ name: "👤 작업자", value: `${interaction.member}`, inline: true });

      if (player.currentTrack.thumbnail) {
        embed.setThumbnail(player.currentTrack.thumbnail);
      }

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      if (interaction.client.musicEmbedManager) {
        await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    } else {
      await interaction.reply({
        content: "❌ 작업이 실패했습니다!",
        flags: [1 << 6],
      });
    }
  },

  async handleSkip(interaction, player, _requesterId) {
    // DJ 계층 또는 현재 곡의 요청자 본인은 스킵 가능
    const permErr = await checkSkip(interaction.member, player);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    if (!player.currentTrack) {
      return await interaction.reply({
        content: S.ERR_NO_SONG_PLAYING,
        flags: [1 << 6],
      });
    }

    // 한곡 반복 중에는 스킵 = 현재 곡 재시작이라 대기열이 비어도 유효
    if (player.queue.length === 0 && player.loop !== "track") {
      return await interaction.reply({
        content: "❌ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다.",
        flags: [1 << 6],
      });
    }

    const currentTrack = player.currentTrack;
    const skipped = player.skip();

    if (skipped && player.loop === "track") {
      return await interaction.reply({
        content: `🔂 한곡 반복 중 — **${currentTrack.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`,
        flags: [1 << 6],
      });
    }

    if (skipped) {
      const embed = new EmbedBuilder()
        .setTitle("⏭️ 노래 건너뜀")
        .setDescription(`**[${currentTrack.title}](${currentTrack.url})** 건너뜀!`)
        .setColor(config.bot.embedColor)
        .setTimestamp()
        .addFields({ name: "👤 건너뛴 사람", value: `${interaction.member}`, inline: true });

      if (player.queue.length > 0) {
        embed.addFields({
          name: "🔜 다음 노래",
          value: `[${player.queue[0].title}](${player.queue[0].url})`,
          inline: false,
        });
        embed.setFooter({ text: `대기열에 ${player.queue.length}개의 노래가 더 있습니다` });
      } else {
        embed.setFooter({ text: "대기열에 더 이상 노래가 없습니다" });
      }

      if (currentTrack.thumbnail) {
        embed.setThumbnail(currentTrack.thumbnail);
      }

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      if (interaction.client.musicEmbedManager && player.currentTrack) {
        await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    } else {
      await interaction.reply({
        content: "❌ 노래가 건너뛰어지지 않았습니다!",
        flags: [1 << 6],
      });
    }
  },

  async handlePrevious(interaction, player) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    // 한곡 반복 중에는 이전곡 = 현재 곡 재시작이라 기록이 없어도 유효
    if (player.previousTracks.length === 0 && player.loop !== "track") {
      return await interaction.reply({
        content: "❌ 이전 노래가 없습니다!",
        flags: [1 << 6],
      });
    }

    const result = player.previous();

    if (result) {
      await interaction.reply({
        content: player.loop === "track" ? "🔂 한곡 반복 중 — 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!",
        flags: [1 << 6],
      });
    } else {
      await interaction.reply({
        content: "❌ 이전 노래로 이동하지 못했습니다!",
        flags: [1 << 6],
      });
    }
  },

  async handleStop(interaction, player, client, _requesterId) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    const queueLength = player.queue.length;
    const currentTrack = player.currentTrack;

    player.stop();
    client.players.delete(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 음악 중지됨")
      .setDescription(`${currentTrack ? `**[${currentTrack.title}](${currentTrack.url})**` : "Music"} 중지됨!`)
      .setColor("#FF0000")
      .setTimestamp()
      .addFields({ name: "👤 중지한 사람", value: `${interaction.member}`, inline: true });

    if (queueLength > 0) {
      embed.setFooter({ text: `대기열에서 ${queueLength}개의 노래가 제거되었습니다` });
    }

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) {
      await client.musicEmbedManager.handlePlaybackEnd(player);
    }
  },

  async handleQueue(interaction, player) {
    const queueInfo = player.getQueue();

    if (!queueInfo.current && queueInfo.queue.length === 0) {
      return await interaction.reply({
        content: S.ERR_NO_SONGS_IN_QUEUE,
        flags: [1 << 6],
      });
    }

    const embed = new EmbedBuilder().setTitle("📝 재생 대기열").setColor(config.bot.embedColor).setTimestamp();

    if (queueInfo.current) {
      const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
      const progress = this.createProgressBar(currentTime, queueInfo.current.duration);

      embed.addFields({
        name: "🎵 현재 재생 중",
        value: `**[${queueInfo.current.title}](${queueInfo.current.url})**\n${progress}`,
        inline: false,
      });
    }

    if (queueInfo.queue.length > 0) {
      let queueText = "";
      const tracks = queueInfo.queue.slice(0, 10);

      tracks.forEach((track, index) => {
        queueText += `\`${index + 1}.\` **[${track.title}](${track.url})**\n`;
      });

      if (queueInfo.queue.length > 10) {
        queueText += `\n*... 그리고 ${queueInfo.queue.length - 10}개 더*`;
      }

      embed.addFields({
        name: `📋 다음 노래들 (${queueInfo.queue.length}개)`,
        value: queueText,
        inline: false,
      });
    }

    embed.setFooter({
      text: `총 ${queueInfo.queue.length + (queueInfo.current ? 1 : 0)}개의 노래`,
    });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handleShuffle(interaction, player, _requesterId) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    if (player.queue.length < 2) {
      return await interaction.reply({
        content: "❌ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!",
        flags: [1 << 6],
      });
    }

    player.shuffleQueue();

    const embed = new EmbedBuilder()
      .setTitle("🔀 대기열 셔플됨")
      .setDescription(`${player.queue.length}개의 노래가 셔플되었습니다!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 셔플한 사람", value: `${interaction.member}`, inline: true });

    if (player.queue.length > 0) {
      const nextTracks = player.queue.slice(0, 3);
      let trackList = "";
      nextTracks.forEach((track, index) => {
        trackList += `${index + 1}. **[${track.title}](${track.url})**\n`;
      });
      embed.addFields({ name: "🔜 다음 노래들", value: trackList, inline: false });
    }

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (interaction.client.musicEmbedManager) {
      await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
  },

  async handleVolumeModal(interaction, _player, _requesterId) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    const modal = new ModalBuilder().setCustomId("volume_modal").setTitle("볼륨 설정");

    const volumeInput = new TextInputBuilder().setCustomId("volume_input").setLabel("볼륨 (0-100)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setPlaceholder("50").setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(volumeInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  },

  async handleLoop(interaction, player, _requesterId) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    if (!player.currentTrack) {
      return await interaction.reply({
        content: S.ERR_NO_SONG_PLAYING,
        flags: [1 << 6],
      });
    }

    let newLoopMode, modeMessage, modeEmoji;

    if (player.loop === false || player.loop === "off") {
      newLoopMode = "track";
      modeMessage = "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다.";
      modeEmoji = "🔂";
    } else if (player.loop === "track") {
      newLoopMode = "queue";
      modeMessage = "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다.";
      modeEmoji = "🔁";
    } else {
      newLoopMode = false;
      modeMessage = "반복 모드가 이제 **꺼졌습니다**";
      modeEmoji = "➡️";
    }

    player.loop = newLoopMode;

    const embed = new EmbedBuilder()
      .setTitle(`${modeEmoji} 🔁 반복 모드 변경됨`)
      .setDescription(modeMessage)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${interaction.member}`, inline: true });

    if (player.currentTrack && player.currentTrack.thumbnail) {
      embed.setThumbnail(player.currentTrack.thumbnail);
    }

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (interaction.client.musicEmbedManager) {
      await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
  },

  async handleAutoplay(interaction, player, requesterId) {
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require("discord.js");

    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    if (player.autoplay) {
      player.autoplay = false;

      const embed = new EmbedBuilder().setTitle("🎲 자동 재생이 비활성화되었습니다").setDescription("자동 재생 기능이 꺼졌습니다.").setColor(config.bot.embedColor).setTimestamp();

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      if (interaction.client.musicEmbedManager) {
        await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
      return;
    }

    // 장르 정의는 config/genres.js
    const genres = require("../config/genres");

    const select = new StringSelectMenuBuilder()
      .setCustomId(`autoplay_genre:${requesterId}:${player.sessionId}`)
      .setPlaceholder("음악 장르를 선택하세요...")
      .addOptions(Object.entries(genres).map(([value, g]) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(value).setEmoji(g.emoji)));

    const row = new ActionRowBuilder().addComponents(select);

    const embed = new EmbedBuilder().setTitle("🎲 🎵 음악 장르 선택").setDescription("대기열이 끝나면 어떤 장르를 재생할까요?").setColor(config.bot.embedColor);

    await interaction.reply({ embeds: [embed], components: [row], flags: [1 << 6] });
  },

  createProgressBar(current, total) {
    if (!total || total === 0) return "0:00 / 0:00";

    const currentSeconds = Math.floor(current / 1000);
    const totalSeconds = Math.floor(total);
    const progress = Math.floor((currentSeconds / totalSeconds) * 20);

    return `${this.formatTime(currentSeconds)} [${"▓".repeat(progress)}${"░".repeat(20 - progress)}] ${this.formatTime(totalSeconds)}`;
  },

  formatTime(seconds) {
    return formatDuration(seconds); // 공용 구현: src/utils.js
  },

  async handleHelpRefresh(interaction) {
    try {
      await interaction.deferUpdate();
      const helpCommand = require("../commands/help.js");
      const { embed, row } = await helpCommand.buildHelpEmbed(interaction.client);
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error("Error refreshing help:", error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!", flags: [1 << 6] });
        } else {
          await interaction.followUp({ content: "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!", flags: [1 << 6] });
        }
      } catch (err) {
        console.error("Failed to send error message:", err);
      }
    }
  },

  async handleSystemRefresh(interaction) {
    // /system과 동일하게 봇 운영자 전용
    if (interaction.user.id !== config.dashboard.ownerId) {
      return await interaction.reply({ content: "❌ 봇 운영자만 사용할 수 있습니다!", flags: [1 << 6] });
    }

    try {
      await interaction.deferUpdate();
      const systemCommand = require("../commands/system.js");
      const { embed, row } = systemCommand.buildSystemEmbed(interaction.client);
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error("Error refreshing system:", error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!", flags: [1 << 6] });
        } else {
          await interaction.followUp({ content: "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!", flags: [1 << 6] });
        }
      } catch (err) {
        console.error("Failed to send error message:", err);
      }
    }
  },

  async handleSearchInteraction(interaction, client) {
    const member = interaction.member;
    const guild = interaction.guild;

    // 곡 추가 경로 — 봇 동작 중에는 재적 규칙만(관리자 면제), 유휴 시에는 소환 대상이 필요하므로 본인 재적 필수
    const botVoiceChannel = guild.members.me?.voice?.channel;
    if (botVoiceChannel) {
      const permErr = checkAdd(member);
      if (permErr) {
        return await interaction.reply({
          content: permErr,
          flags: [1 << 6],
        });
      }
    } else if (!member.voice.channel) {
      return await interaction.reply({
        content: S.ERR_VOICE_REQUIRED,
        flags: [1 << 6],
      });
    }

    // 메시지 ID로 키잉 — 같은 사용자의 재검색/다른 길드의 검색과 섞이지 않음 (감사 M-08)
    const userSearchData = client.searchResults?.get(interaction.message.id);
    if (!userSearchData) {
      return await interaction.reply({
        content: "❌ 검색 결과를 찾을 수 없거나 만료되었습니다! 다시 검색해 주세요.",
        flags: [1 << 6],
      });
    }

    if (userSearchData.userId !== interaction.user.id) {
      return await interaction.reply({
        content: "❌ 검색을 요청한 사용자만 선택할 수 있습니다!",
        flags: [1 << 6],
      });
    }

    if (interaction.customId === "search_cancel") {
      client.searchResults.delete(interaction.message.id);

      const embed = new EmbedBuilder().setTitle("❌ 검색 취소됨").setDescription("검색이 취소되었습니다.").setColor("#FF0000").setTimestamp();

      return await interaction.update({ embeds: [embed], components: [] });
    }

    const selectedIndex = parseInt(interaction.customId.replace("search_select_", ""));
    const selectedTrack = userSearchData.results[selectedIndex];

    if (!selectedTrack) {
      return await interaction.reply({
        content: "❌ 잘못된 선택입니다!",
        flags: [1 << 6],
      });
    }

    await interaction.deferUpdate();

    const processingEmbed = new EmbedBuilder().setTitle("🔄 처리 중...").setDescription(`**${selectedTrack.title}** 추가 중...`).setColor("#FFAA00").setTimestamp();

    await interaction.editReply({ embeds: [processingEmbed], components: [] });

    try {
      const MusicEmbedManager = require("../src/MusicEmbedManager");
      if (!client.musicEmbedManager) {
        client.musicEmbedManager = new MusicEmbedManager(client);
      }

      if (!client.players) {
        client.players = new Map();
      }

      // 봇이 이미 접속 중이면 그 채널 기준 (관리자 원격 추가 대응)
      let player = client.players.get(guild.id);
      if (!player) {
        player = new MusicPlayer(guild, interaction.channel, member.voice.channel ?? botVoiceChannel ?? null);
        client.players.set(guild.id, player);
      }

      // 봇이 유휴 상태에서 소환될 때만 음성 대상을 갱신 — 재생 중 다른 채널 참조로 오염 방지
      if (!botVoiceChannel && member.voice.channel) {
        player.voiceChannel = member.voice.channel;
      }
      player.textChannel = interaction.channel;

      // interaction=null 전달: 검색 메시지는 일반 임베드 - Components V2 현재 재생 메시지로 수정할 수 없음. 임베드 매니저가 텍스트 채널에 새 메시지를 보냄
      const result = await client.musicEmbedManager.handleMusicData(guild.id, { isPlaylist: false, tracks: [selectedTrack] }, member, null);

      client.searchResults.delete(interaction.message.id);

      if (!result.success) {
        const errorEmbed = new EmbedBuilder().setTitle("❌ 오류").setDescription(result.message).setColor("#FF0000").setTimestamp();

        return await interaction.editReply({ embeds: [errorEmbed], components: [] });
      }

      // 검색 결과 메시지 제거 — 현재 재생/대기열 정보는 별도로 전송됨
      await interaction.deleteReply().catch(() => {});
    } catch (error) {
      const errorEmbed = new EmbedBuilder().setTitle("❌ 오류").setDescription(S.ERR_PROCESSING).setColor("#FF0000").setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    }
  },
};
