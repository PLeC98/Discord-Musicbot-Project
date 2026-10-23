import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { join, type JoinResult } from "../../usecases/join.ts";
import { checkPanelChannel } from "../../usecases/permissions.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { noticeFrame, reply } from "../../ui/frame.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll, toSelf } from "../../ui/delivery.ts";

// 결과를 알린다. 거절 · "이미 있어요"는 본인에게, 붙었거나 복원한 결과는 모두에게(복원하는 동안의 "불러오는 중" 자리표시자를 삭제하고)
async function answer(interaction: ChatInputCommandInteraction<"cached">, result: JoinResult) {
  switch (result.kind) {
    case "refused":
      return noticeSelf(interaction, errors.notice(result.code));
    case "already":
      return toSelf(interaction, reply(replies.alreadyJoined()), LIFETIME.glance);
    case "joined":
      return toAll(interaction, replies.joined(), LIFETIME.result);
    case "restored":
      return toAll(interaction, replies.restoreResult(result.track, result.player.paused, result.left), LIFETIME.result);
    case "restore-error":
      return toAll(interaction, noticeFrame(errors.notice("restore-failed")), LIFETIME.result);
  }
}

const exported: GuildCommand = {
  help: { section: "channel", tier: "everyone" },
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시켜요" }),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    const panelErr = await checkPanelChannel(guild, interaction, bot.players.get(guild.id)?.textChannel);
    if (panelErr) return noticeSelf(interaction, errors.notice(panelErr));
    // 저장한 세션을 복원하는 동안 "불러오는 중"을 본인에게 먼저 보낸다
    const result = await join(bot, { guild, member, textChannel: channel }, { restoring: () => interaction.reply(reply(replies.restoring())) });
    await answer(interaction, result);
  },
};
export default exported;
