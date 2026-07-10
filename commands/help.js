"use strict";

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show all commands").setDescriptionLocalizations({ ko: "모든 명령어를 표시합니다" }),

  async buildHelpEmbed(client) {
    let guilds, users, activeServers;

    if (client.shard) {
      try {
        const guildCounts = await client.shard.fetchClientValues("guilds.cache.size");
        guilds = guildCounts.reduce((acc, count) => acc + count, 0);
        const memberCounts = await client.shard.broadcastEval((c) => c.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0));
        users = memberCounts.reduce((acc, count) => acc + count, 0);
        const activePlayers = await client.shard.broadcastEval((c) => c.players.size);
        activeServers = activePlayers.reduce((acc, count) => acc + count, 0);
      } catch (error) {
        guilds = client.guilds.cache.size;
        users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        activeServers = client.players.size;
      }
    } else {
      guilds = client.guilds.cache.size;
      users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
      activeServers = client.players.size;
    }

    const embed = new EmbedBuilder().setTitle("🎵 도움말").setDescription("🔒 표시 명령어는 **봇과 같은 음성 채널에 있는 DJ**부터 사용할 수 있습니다. 관리자(모더레이터)는 채널에 없어도 사용 가능해요.\nDJ 역할이 설정되지 않은 서버에서는 전원이 DJ로 취급됩니다. (`/setdjrole`)").setColor(config.bot.embedColor).setThumbnail(client.user.displayAvatarURL()).setTimestamp();
    embed.addFields({
      name: "🎵 재생",
      value: ["`/play <곡/URL>` — 음악 재생", "`/playfirst <곡/URL>` — 대기열 맨 앞에 추가 🔒", "`/pause` — 일시정지 / 재개 🔒", "`/stop` — 재생 중지 및 퇴장 🔒", "`/skip` — 다음 곡 🔒 (자기가 추가한 곡은 누구나)", "`/previous` — 이전 곡 🔒", "`/replay` — 현재 곡 처음부터 🔒", "`/seek <시간>` — 특정 위치로 이동 (예: `1:30`, `90`) 🔒"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "📋 대기열",
      value: ["`/queue [페이지]` — 대기열 표시", "`/clear` — 대기열 비우기 🔒", "`/remove <번호>` — 특정 곡 제거 🔒 (자기가 추가한 곡은 누구나)", "`/move <from> <to>` — 곡 순서 변경 🔒", "`/shuffle` — 대기열 셔플 🔒"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "🎛️ 모드 & 오디오",
      value: ["`/loop [mode]` — 반복 설정 (`off` · `track` · `queue`) 🔒", "`/autoplay <장르>` — 대기열 소진 시 자동 재생 🔒", "`/volume <0-100>` — 볼륨 설정 🔒"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "🔍 탐색 & 정보",
      value: ["`/search <검색어>` — YouTube 검색 후 선택", "`/nowplaying` — 현재 곡 상세 정보"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "📡 채널 & 세션",
      value: ["`/join` — 음성 채널 입장 (이전 세션 복구)", "`/leave` — 퇴장 및 세션 저장 🔒", "`/setchannel` — 전용 채널 지정 (관리자)", "`/setdjrole` — DJ 역할 지정 (관리자)", "`/dashboard` — 컨트롤 패널 재게시 (봇 전용 채널에서는 전원, 그 외 🔒)"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "📊 봇 정보",
      value: ["`/ping` — 레이턴시 확인 (관리자)", "`/system` — 시스템 상태 (봇 운영자)", "`/cachestatus` — 오디오 캐시 통계 (관리자)"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "🌐 지원 플랫폼",
      value: ["🔴 **YouTube** - 비디오/음악 링크 및 검색", "🟢 **Spotify** - 노래/재생목록/앨범 링크", "🟠 **SoundCloud** - 음악 링크 및 검색", "🔗 **직접 링크** - MP3, WAV, OGG 파일"].join("\n"),
      inline: false,
    });
    embed.addFields({
      name: "📊 통계",
      value: [`🏠 **서버:** ${guilds}개`, `👥 **사용자:** ${users.toLocaleString()}명`, `🎵 **활성 서버:** ${activeServers}개`, `⏱️ **업타임:** ${this.formatUptime(process.uptime())}`].join("\n"),
      inline: true,
    });
    // WEBSITE는 선택 설정(null 허용) — 없으면 링크/버튼을 생략한다
    const links = [`[📄 Invite Bot](${config.bot.invite})`];
    if (config.bot.website) links.unshift(`[🌐 Website](${config.bot.website})`);
    embed.addFields({
      name: "🔗 링크",
      value: links.join("\n"),
      inline: true,
    });
    embed.setFooter({
      text: client.user.username,
      iconURL: client.user.displayAvatarURL(),
    });
    const buttons = [];
    if (config.bot.website) buttons.push(new ButtonBuilder().setLabel("웹사이트").setEmoji("🌐").setURL(config.bot.website).setStyle(ButtonStyle.Link));
    buttons.push(new ButtonBuilder().setCustomId("help_refresh").setLabel("새로고침").setEmoji("🔄").setStyle(ButtonStyle.Secondary));
    const row = new ActionRowBuilder().addComponents(...buttons);
    return { embed, row };
  },

  async execute(interaction, client) {
    try {
      const { embed, row } = await this.buildHelpEmbed(client);
      await interaction.reply({ embeds: [embed], components: [row], flags: [1 << 6] });
    } catch (error) {
      const errorEmbed = new EmbedBuilder().setTitle("❌ 오류").setDescription("도움말을 불러오는 중 오류가 발생했습니다!").setColor("#FF0000").setTimestamp();

      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ embeds: [errorEmbed] });
        } else if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [errorEmbed], flags: [1 << 6] });
        }
      } catch (responseError) {
        console.error("❌ 도움말 오류 응답 전송 중 오류:", responseError);
      }
    }
  },
  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}일 ${h}시간 ${m}분`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  },
};
