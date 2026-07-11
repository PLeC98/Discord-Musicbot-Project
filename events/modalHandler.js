const { Events, EmbedBuilder, MessageFlags } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

    const client = interaction.client;

    try {
      // 선택 메뉴 처리
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("autoplay_genre:")) {
          await this.handleAutoplayGenre(interaction, client);
          return;
        }
        if (interaction.customId.startsWith("music_jumpto:")) {
          await this.handleJumpTo(interaction, client);
          return;
        }
      }

      // 모달 처리
      switch (interaction.customId) {
        case "volume_modal":
          await this.handleVolumeModal(interaction, client);
          break;

        default:
          await interaction.reply({
            content: "❌ 알 수 없는 모달!",
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: S.ERR_PROCESSING,
            flags: MessageFlags.Ephemeral,
          });
        } catch (replyError) {}
      }
    }
  },

  async handleAutoplayGenre(interaction, client) {
    const guild = interaction.guild;
    const member = interaction.member;

    // 음악 플레이어 가져오기
    const player = client.players.get(guild.id);
    if (!player) {
      return await interaction.reply({
        content: S.ERR_NO_MUSIC,
        flags: [1 << 6],
      });
    }

    // 자동재생 설정은 재생 조작 — DJ 계층 + 재적 규칙 (관리자 면제)
    const permErr = await checkControl(member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    const selectedGenre = interaction.values[0];

    // 알 수 없는 장르 처리
    const genres = require("../config/genres");
    if (!genres[selectedGenre]) {
      return await interaction.reply({
        content: `❌ 알 수 없는 장르입니다: \`${selectedGenre}\`. 자동재생 버튼을 다시 눌러 선택해 주세요.`,
        flags: [1 << 6],
      });
    }

    // 선택한 장르로 자동재생 활성화
    player.autoplay = selectedGenre;

    const genreName = genres[selectedGenre].label;
    const embed = new EmbedBuilder()
      .setTitle("🎲 자동 재생이 활성화되었습니다")
      .setDescription(`**${genreName}** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({
        name: "👤 변경한 사람",
        value: `${member}`,
        inline: true,
      });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    // 자동재생이 활성화되었음을 표시하도록 메인 임베드 갱신
    if (client.musicEmbedManager) {
      await client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
  },

  async handleVolumeModal(interaction, client) {
    const guild = interaction.guild;
    const member = interaction.member;

    // 음악 플레이어 가져오기
    const player = client.players.get(guild.id);
    if (!player) {
      return await interaction.reply({
        content: S.ERR_NO_MUSIC,
        flags: MessageFlags.Ephemeral,
      });
    }

    // 볼륨 변경은 재생 조작 — DJ 계층 + 접속 규칙 (관리자 면제)
    const permErr = await checkControl(member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: MessageFlags.Ephemeral,
      });
    }

    const volumeInput = interaction.fields.getTextInputValue("volume_input");
    const volume = parseInt(volumeInput);

    // 볼륨 검증
    if (isNaN(volume) || volume < 0 || volume > 100) {
      return await interaction.reply({
        content: "❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!",
        flags: MessageFlags.Ephemeral,
      });
    }

    const appliedVolume = player.setVolume(volume);

    const embed = new EmbedBuilder()
      .setTitle("🔊 볼륨이 변경되었습니다")
      .setDescription(`볼륨이 **${appliedVolume}%**로 설정되었습니다!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({
        name: "👤 설정한 사람",
        value: `${member}`,
        inline: true,
      });

    // 시각적 볼륨 바
    const volumeBar = this.createVolumeBar(appliedVolume);
    embed.addFields({
      name: "🔉 레벨",
      value: volumeBar,
      inline: false,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  createVolumeBar(volume) {
    const barLength = 20;
    const filledBars = Math.floor((volume / 100) * barLength);
    const emptyBars = barLength - filledBars;

    const bar = "▓".repeat(filledBars) + "░".repeat(emptyBars);
    return `\`${bar}\` ${volume}%`;
  },

  async handleJumpTo(interaction, client) {
    const guild = interaction.guild;
    const member = interaction.member;

    const player = client.players.get(guild.id);
    if (!player) {
      return await interaction.reply({
        content: S.ERR_NO_MUSIC,
        flags: [1 << 6],
      });
    }

    const [, , sessionId] = interaction.customId.split(":");

    if (sessionId && player.sessionId && sessionId !== player.sessionId) {
      return await interaction.reply({
        content: S.ERR_SESSION_INVALID,
        flags: [1 << 6],
      });
    }

    const permErr = await checkControl(member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    const selectedIndex = parseInt(interaction.values[0]);

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= player.queue.length) {
      return await interaction.reply({
        content: "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!",
        flags: [1 << 6],
      });
    }

    // 현재 위치에서 꺼내 맨 앞으로 이동
    const [selectedTrack] = player.queue.splice(selectedIndex, 1);
    player.queue.unshift(selectedTrack);
    // 셔플이 켜져 있어도 다음 전환에서 queue[0]을 선택하도록 강제
    player.nextFromFront = true;

    // 현재 곡 건너뛰기 → selectedTrack이 다음에 재생됨.
    // "jump" 사유: 한곡 반복 중에도 재시작이 아니라 선택한 곡으로 이동해야 함
    const skipped = player.skip("jump");

    if (skipped) {
      await interaction.reply({
        content: `⏭️ **${selectedTrack.title}**로 이동했습니다!`,
        flags: [1 << 6],
      });
    } else {
      // 스킵 실패 시 롤백
      player.nextFromFront = false;
      player.queue.shift();
      player.queue.splice(selectedIndex, 0, selectedTrack);
      await interaction.reply({
        content: "❌ 곡으로 이동하지 못했습니다!",
        flags: [1 << 6],
      });
    }
  },
};
