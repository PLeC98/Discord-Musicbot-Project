import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { ensurePlayer } from "../src/usecases/addTracks.ts";
import * as playerEvents from "../src/player/events.ts";
import { sessions } from "../src/store/playerSessions.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import * as replies from "../src/ui/controlReplies.ts";
import * as controlText from "../src/ui/text/ko/controls.ts";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { messageOf } from "../src/rules/errorKind.ts";
import { bestEffort } from "../src/infra/bestEffort.ts";
import { expireReply } from "../src/ui/replyLifetime.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시켜요" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return interaction.reply(noticeReply(errors.mustBeInVoice()));

    const me = guild.members.me;
    const permissions = me ? member.voice.channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return interaction.reply(noticeReply(errors.permissionVoice()));

    // 이미 채널에 붙어 있음(붙는 중 · 끊겨 다시 붙는 중 포함)
    const existing = client.players.get(guild.id);
    if (existing?.voice.isAlive()) {
      return interaction.reply(reply(replies.alreadyJoined()));
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
          await interaction.editReply({ content: controlText.restoredEmpty() });
          return;
        }

        // restoreFromState가 이미 새 CV2 현재 재생 메시지를 보냈음;
        // defer된 응답은 CV2 메시지로 수정할 수 없으므로 일반 응답으로 유지
        await interaction.editReply({ content: controlText.restored(player.currentTrack, player.paused) });
      } catch (error) {
        log.error({ sub: "join" }, "세션 복원 실패:", messageOf(error));
        await player.dispose({ reason: "세션 복원 실패", session: "keep" });
        await interaction.editReply({ content: controlText.restoreFailed() });
      }
    } else {
      await player.voice.connect();
      bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
      // 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
      if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
      playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${error?.message || error}`));
      await interaction.reply(reply(replies.joined()));
    }
  },
};
export default exported;
