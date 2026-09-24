import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import logger from "../src/infra/log/logger.js";
const log = logger.child({ category: "commands" });
import addTracks from "../src/usecases/addTracks.js";
const { ensurePlayer } = addTracks;
import playerEvents from "../src/player/events.js";
import playerSessions from "../src/store/playerSessions.js";
const { sessions } = playerSessions;
import mentions from "../src/ui/mentions.js";
const { escapeMd } = mentions;
import S from "../src/ui/strings.js";
import config from "../config.js";

const exported = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시킵니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return interaction.reply({ content: S.ERR_NO_PERMISSIONS, flags: [1 << 6] });

    // 이미 채널에 접속해 있음
    const existing = client.players.get(guild.id);
    if (existing?.connection) {
      return interaction.reply({ content: "✅ 이미 채널에 접속해 있어요.", flags: [1 << 6] });
    }

    // /leave에서 저장한 세션이 있는지 확인
    const savedState = sessions().load(guild.id);
    const hasSession = savedState?.current;

    // 연결이 끊긴 채 맵에 남은 플레이어를 교체하기 전에 정리한다. 재접속 실패(VoiceConnectionManager)로
    // 남은 경우 타이머·상태 동기화가 계속 돌고 캐시 퇴거 보호도 걸린 채라, 그냥 버리면 새 플레이어와
    // 같은 서버 키를 두고 경쟁한다. 살아 있던 대기열은 승계하지 않는다(미해결).
    if (existing) {
      existing.releaseResources();
      existing.releaseAudioProtection();
      client.players.delete(guild.id);
    }

    const player = ensurePlayer(client, { guild, textChannel: channel, voiceChannel: member.voice.channel });

    if (hasSession) {
      await interaction.deferReply();
      try {
        await player.restoreFromState(savedState);

        if (!player.currentTrack) {
          await interaction.editReply({ content: "✅ 음성 채널에 접속했어요. (세션 복구 실패 - 곡을 찾을 수 없음)" });
          return;
        }

        // restoreFromState가 이미 새 CV2 현재 재생 메시지를 보냈음;
        // defer된 응답은 CV2 메시지로 수정할 수 없으므로 일반 응답으로 유지
        const title = escapeMd(player.currentTrack.title);
        await interaction.editReply({ content: player.paused ? `⏸️ 이전 세션을 복구했어요! **${title}**. 일시정지 상태예요` : `▶️ 이전 세션을 복구했어요! **${title}** 재생 중` });
      } catch (error) {
        log.error({ sub: "join" }, "세션 복원 실패:", error.message);
        player.releaseResources();
        player.disconnect();
        client.players.delete(guild.id);
        await interaction.editReply({ content: "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요." });
      }
    } else {
      await player.connect();
      player.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});
      // 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
      if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
      playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${error?.message || error}`));
      await interaction.reply({ content: "✅ 음성 채널에 접속했어요!", flags: [1 << 6] });
    }
  },
};
export default exported;
export { exported as "module.exports" };
