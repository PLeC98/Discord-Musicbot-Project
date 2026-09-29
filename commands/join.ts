import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { ensurePlayer } from "../src/usecases/addTracks.ts";
import * as playerEvents from "../src/player/events.ts";
import { sessions } from "../src/store/playerSessions.ts";
import { escapeMd } from "../src/ui/mentions.ts";
import * as S from "../src/ui/strings.ts";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { messageOf } from "../src/rules/errorKind.ts";
import { bestEffort } from "../src/infra/bestEffort.ts";
import { expireReply } from "../src/ui/replyLifetime.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시킵니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: MessageFlags.Ephemeral });

    const me = guild.members.me;
    const permissions = me ? member.voice.channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return interaction.reply({ content: S.ERR_NO_PERMISSIONS, flags: MessageFlags.Ephemeral });

    // 이미 채널에 붙어 있음(붙는 중 · 끊겨 다시 붙는 중 포함)
    const existing = client.players.get(guild.id);
    if (existing?.voice.isAlive()) {
      return interaction.reply({ content: "✅ 이미 채널에 접속해 있어요.", flags: MessageFlags.Ephemeral });
    }

    // /leave에서 저장한 세션이 있는지 확인
    const savedState = sessions().load(guild.id);
    const hasSession = savedState?.current;

    // 붙지 않은 채 남은 플레이어(붙기 실패 등)는 정리하고 새로 만든다. 그냥 버리면 타이머 · 상태 동기화 · 캐시 퇴거 보호가
    // 걸린 채 새 플레이어와 같은 서버 키를 두고 경쟁한다. 저장한 세션은 그대로 두어 아래에서 되살린다
    if (existing) await existing.dispose({ reason: "/join 교체", session: "keep" });

    const player = ensurePlayer(client, { guild, textChannel: channel, voiceChannel: member.voice.channel });

    if (hasSession) {
      await interaction.deferReply();
      // 모두에게 보이는 응답이라 기본 정리에서 빠진다. 되살린 결과는 패널이 보이므로 잠깐 뒤 지운다
      expireReply(interaction);
      try {
        await player.persistence.restoreFromState(savedState);

        if (!player.currentTrack) {
          await interaction.editReply({ content: "✅ 음성 채널에 접속했어요. (세션 복구 실패 - 곡을 찾을 수 없음)" });
          return;
        }

        // restoreFromState가 이미 새 CV2 현재 재생 메시지를 보냈음;
        // defer된 응답은 CV2 메시지로 수정할 수 없으므로 일반 응답으로 유지
        const title = escapeMd(player.currentTrack.title);
        await interaction.editReply({ content: player.paused ? `⏸️ 이전 세션을 복구했어요! **${title}** 일시정지 중` : `▶️ 이전 세션을 복구했어요! **${title}** 재생 중` });
      } catch (error) {
        log.error({ sub: "join" }, "세션 복원 실패:", messageOf(error));
        await player.dispose({ reason: "세션 복원 실패", session: "keep" });
        await interaction.editReply({ content: "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요." });
      }
    } else {
      await player.voice.connect();
      bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
      // 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
      if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
      playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${error?.message || error}`));
      await interaction.reply({ content: "✅ 음성 채널에 접속했어요!", flags: MessageFlags.Ephemeral });
    }
  },
};
export default exported;
