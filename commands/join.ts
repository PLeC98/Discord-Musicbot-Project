import { SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { ensurePlayer } from "../src/usecases/addTracks.ts";
import * as playerEvents from "../src/player/events.ts";
import { sessions, type RestoredSession } from "../src/store/playerSessions.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeFrame, post, reply } from "../src/ui/frame.ts";
import type { Player } from "../src/player/Player.ts";
import * as replies from "../src/ui/controlReplies.ts";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { messageOf } from "../src/rules/errorKind.ts";
import { bestEffort } from "../src/infra/bestEffort.ts";
import { LIFETIME, expireSelf, noticeSelf, toSelf } from "../src/ui/delivery.ts";

// 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
function waitEmpty(player: Player) {
  bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
  if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
  playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${error?.message || error}`));
}

// 저장한 세션을 되살린다. 되살리는 동안 Components V2 로 먼저 답하고 결과로 고친다. 모두에게 보이는 응답이라 기본 정리에서 빠진다.
// 결과는 패널이 보이므로 잠깐 뒤 지운다. 채널 알림은 내지 않는다(이 응답이 말한다)
async function restoreSession(interaction: ChatInputCommandInteraction<"cached">, player: Player, savedState: RestoredSession) {
  await interaction.reply(post(replies.restoring()));
  expireSelf(interaction, LIFETIME.result);
  try {
    const outcome = await player.persistence.restoreFromState(savedState, { announce: false });
    if (outcome === "restored" && player.currentTrack) return await interaction.editReply(post(replies.restored(player.currentTrack, player.paused)));
    // 틀지 못했다. 남은 곡이 있으면 연달아 실패해 멈춘 것이다. 재생 중이던 곡이 저장된 세션만 되살리니 틀 곡이 없는 결과(empty)는 나오지 않는다
    const left = player.queue.length;
    return await interaction.editReply(post(noticeFrame(left > 0 ? errors.notice("restore-failed-in-row", { left }) : errors.notice("restore-nothing-left"))));
  } catch (error) {
    log.error({ sub: "join" }, "세션 복원 실패:", messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "keep" });
    return await interaction.editReply(post(noticeFrame(errors.notice("restore-failed"))));
  }
}

const exported: GuildCommand = {
  help: { section: "channel", tier: "everyone" },
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시켜요" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return noticeSelf(interaction, errors.notice("must-be-in-voice"));

    const me = guild.members.me;
    const permissions = me ? member.voice.channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return noticeSelf(interaction, errors.notice("permission-voice"));

    // 이미 채널에 붙어 있음(붙는 중 · 끊겨 다시 붙는 중 포함)
    const existing = client.players.get(guild.id);
    if (existing?.voice.isAlive()) {
      return toSelf(interaction, reply(replies.alreadyJoined()), LIFETIME.glance);
    }

    // /leave에서 저장한 세션이 있는지 확인
    const savedState = sessions().load(guild.id);
    const hasSession = savedState?.current;

    // 붙지 않은 채 남은 플레이어(붙기 실패 등)는 정리하고 새로 만든다. 그냥 버리면 타이머 · 상태 동기화 · 캐시 퇴거 보호가
    // 걸린 채 새 플레이어와 같은 서버 키를 두고 경쟁한다. 저장한 세션은 그대로 두어 아래에서 되살린다
    if (existing) await existing.dispose({ reason: "/join 교체", session: "keep" });

    const player = ensurePlayer(client, { guild, textChannel: channel, voiceChannel: member.voice.channel });

    if (hasSession) {
      await restoreSession(interaction, player, savedState);
    } else {
      await player.voice.connect();
      waitEmpty(player);
      await toSelf(interaction, reply(replies.joined()), LIFETIME.result);
    }
  },
};
export default exported;
