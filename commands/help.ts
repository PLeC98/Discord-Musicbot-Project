import { formatSpan } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { Client } from "discord.js";
import { HELP, customId } from "../src/ui/customIds.ts";

async function buildHelpEmbed(client: Client<true>) {
  const guilds = client.guilds.cache.size;
  const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const activeServers = client.players.size;

  const embed = new EmbedBuilder().setTitle("🎵 도움말").setDescription("🔒 표시 명령어는 **봇과 같은 음성 채널에 있는 DJ**부터 사용할 수 있습니다. 모더레이터는 채널에 없어도 사용 가능해요.\nDJ 역할이 설정되지 않은 서버에서는 전원이 DJ로 취급됩니다. (`/setdjrole`)").setColor(config.bot.embedColor).setThumbnail(client.user.displayAvatarURL()).setTimestamp();
  embed.addFields({
    name: "🎵 재생",
    value: ["`/play <곡/URL>`: 음악 재생", "`/playfirst <곡/URL>`: 대기열 맨 앞에 추가 🔒", "`/pause`: 일시정지 / 재개 🔒", "`/stop`: 재생 중지 및 퇴장 🔒", "`/skip`: 다음 곡 🔒 (자기가 추가한 곡은 누구나)", "`/previous`: 이전 곡 🔒", "`/replay`: 현재 곡 처음부터 🔒", "`/seek <시간>`: 특정 위치로 이동 (예: `1:30`, `90`) 🔒", "`/highlight`: 하이라이트 지점으로 이동 🔒"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "📋 대기열",
    value: ["`/queue [페이지]`: 대기열 표시", "`/clear`: 대기열 비우기 🔒", "`/remove <번호>`: 특정 곡 제거 🔒 (자기가 추가한 곡은 누구나)", "`/move <from> <to>`: 곡 순서 변경 🔒", "`/shuffle`: 대기열 셔플 🔒"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "🎛️ 모드 & 오디오",
    value: ["`/loop [mode]`: 반복 설정 (`off` · `track` · `queue`) 🔒", "`/autoplay`: 자동재생 켜기 · 끄기 (켤 때 장르 선택) 🔒", "`/volume <0-100>`: 볼륨 설정 🔒"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "🔍 탐색 & 정보",
    value: ["`/search <검색어>`: YouTube 검색 후 선택", "`/nowplaying`: 현재 곡 상세 정보"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "📡 채널 & 세션",
    value: ["`/join`: 음성 채널 입장 (이전 세션 복구)", "`/leave`: 퇴장 및 세션 저장 🔒", "`/setchannel`: 전용 채널 지정 (서버 관리 권한)", "`/setdjrole`: DJ 역할 지정 (서버 관리 권한)", "`/setplaylistlimit [곡 수]`: 재생목록을 한 번에 넣는 곡 수 (서버 관리 권한)", "`/sponsorblock`: SponsorBlock 자동 스킵 설정 (서버 관리 권한)", "`/dashboard`: 컨트롤 패널 재게시 (봇 전용 채널에서는 전원, 그 외 🔒)"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "📊 봇 정보",
    value: ["`/ping`: 레이턴시 확인 (서버 관리 권한)", "`/system`: 시스템 상태 (봇 운영자)", "`/cachestatus`: 오디오 캐시 통계 (서버 관리 권한)", "`/license`: 라이선스와 소스 코드 위치"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "🌐 지원 플랫폼",
    value: ["🔴 **YouTube** - 비디오/음악 링크 및 검색", "🟢 **Spotify** - 노래/재생목록/앨범 링크", "🟠 **SoundCloud** - 음악 링크 및 검색", "🔗 **직접 링크** - 오디오/영상 파일 주소 (MP3, FLAC, M4A, MP4 등)"].join("\n"),
    inline: false,
  });
  embed.addFields({
    name: "📊 통계",
    value: [`🏠 **서버:** ${guilds}개`, `👥 **사용자:** ${users.toLocaleString()}명`, `🎵 **활성 서버:** ${activeServers}개`, `⏱️ **업타임:** ${formatSpan(process.uptime())}`].join("\n"),
    inline: true,
  });
  // WEBSITE는 선택 설정(null 허용). 없으면 링크/버튼을 생략한다
  const links = [`[📄 봇 초대하기](${config.bot.invite})`];
  if (config.bot.website) links.unshift(`[🌐 웹사이트](${config.bot.website})`);
  embed.addFields({
    name: "🔗 링크",
    value: links.join("\n"),
    inline: true,
  });
  embed.setFooter({
    text: client.user.username,
    iconURL: client.user.displayAvatarURL(),
  });
  const buttons: ButtonBuilder[] = [];
  if (config.bot.website) buttons.push(new ButtonBuilder().setLabel("웹사이트").setEmoji("🌐").setURL(config.bot.website).setStyle(ButtonStyle.Link));
  buttons.push(new ButtonBuilder().setCustomId(customId(HELP, "refresh")).setLabel("새로고침").setEmoji("🔄").setStyle(ButtonStyle.Secondary));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  return { embed, row };
}

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show all commands").setDescriptionLocalizations({ ko: "모든 명령어를 표시합니다" }),

  async execute(interaction, client) {
    const { embed, row } = await buildHelpEmbed(client);
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
export { buildHelpEmbed };
