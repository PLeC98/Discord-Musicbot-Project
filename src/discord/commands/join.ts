import { SlashCommandBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { ensurePlayer } from "../../usecases/add-tracks.ts";
import * as playerEvents from "../../player/events.ts";
import { sessions, type RestoredSession } from "../../store/player-sessions.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { noticeFrame, reply } from "../../ui/frame.ts";
import type { Player } from "../../player/player.ts";
import * as replies from "../../ui/control-replies.ts";
import config from "../../config/index.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";

// 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
function waitEmpty(player: Player) {
  bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
  if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
  playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${error?.message || error}`));
}

// 저장한 세션을 되살린다. 되살리는 동안 "불러오는 중" 을 본인에게 먼저 보내고, 결과는 모두에게 새로 보낸다(ui/delivery).
// 채널 알림은 내지 않는다(이 응답이 말한다)
async function restoreSession(interaction: ChatInputCommandInteraction<"cached">, player: Player, savedState: RestoredSession) {
  await interaction.reply(reply(replies.restoring()));
  try {
    const outcome = await player.persistence.restoreFromState(savedState, { announce: false });
    if (outcome === "restored" && player.currentTrack) return await toAll(interaction, replies.restored(player.currentTrack, player.paused), LIFETIME.result);
    // 틀지 못했다. 남은 곡이 있으면 연달아 실패해 멈춘 것이다. 재생 중이던 곡이 저장된 세션만 되살리니 틀 곡이 없는 결과(empty)는 나오지 않는다
    const left = player.queue.length;
    return await toAll(interaction, noticeFrame(left > 0 ? errors.notice("restore-failed-in-row", { left }) : errors.notice("restore-nothing-left")), LIFETIME.result);
  } catch (error) {
    log.error({ sub: "join" }, "세션 복원 실패:", messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "keep" });
    return await toAll(interaction, noticeFrame(errors.notice("restore-failed")), LIFETIME.result);
  }
}

const exported: GuildCommand = {
  help: { section: "channel", tier: "everyone" },
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시켜요" }),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return noticeSelf(interaction, errors.notice("must-be-in-voice"));

    const me = guild.members.me;
    const permissions = me ? member.voice.channel.permissionsFor(me) : null;
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return noticeSelf(interaction, errors.notice("permission-voice"));

    // 이미 채널에 붙어 있음(붙는 중 · 끊겨 다시 붙는 중 포함)
    const existing = bot.players.get(guild.id);
    if (existing?.voice.isAlive()) {
      return toSelf(interaction, reply(replies.alreadyJoined()), LIFETIME.glance);
    }

    // /leave 나 종료가 저장해 둔 세션
    const savedState = sessions().load(guild.id);
    const hasSession = savedState?.current;

    // 붙지 않은 채 남은 플레이어(붙기 실패 등)는 정리하고 새로 만든다. 그냥 버리면 타이머 · 상태 동기화 · 캐시 퇴거 보호가
    // 걸린 채 새 플레이어와 같은 서버 키를 두고 경쟁한다. 저장한 세션은 그대로 두어 아래에서 되살린다
    if (existing) await existing.dispose({ reason: "/join 교체", session: "keep" });

    const player = ensurePlayer(bot, { guild, textChannel: channel, voiceChannel: member.voice.channel });

    if (hasSession) {
      await restoreSession(interaction, player, savedState);
    } else {
      await player.voice.connect();
      waitEmpty(player);
      await toAll(interaction, replies.joined(), LIFETIME.result);
    }
  },
};
export default exported;
