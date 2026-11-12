import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { join, joinRefusal, type JoinResult } from "../../usecases/join.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { noticeFrame, post, reply } from "../../ui/frame.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeMs, noticeSelf, replaceSelf, toAll, toSelf, unlessGone } from "../../ui/delivery.ts";
import { acceptWith } from "../interactions/control-answers.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "commands" });

// 결과를 알린다. 거절, "이미 있어요"는 본인에게(받아들인 뒤면 "참가하는 중" 자리표시자를 고쳐서), 붙었거나 복원한 결과는 자리표시자를 삭제하고 모두에게 알린다
async function answer(interaction: ChatInputCommandInteraction<"cached">, result: JoinResult) {
  const placed = interaction.replied;
  switch (result.kind) {
    case "refused": {
      const notice = errors.notice(result.code);
      return placed ? replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)) : noticeSelf(interaction, notice);
    }
    case "already":
      return placed ? replaceSelf(interaction, replies.alreadyJoined(result.player.parked), LIFETIME.glance) : toSelf(interaction, reply(replies.alreadyJoined(result.player.parked)), LIFETIME.glance);
    case "joined":
      return toAll(interaction, replies.joined(), LIFETIME.result);
    case "restored":
      return toAll(interaction, replies.restoreResult(result.track, result.player.paused, result.parked), LIFETIME.result);
    case "restore-error":
      return toAll(interaction, noticeFrame(errors.notice("restore-failed")), LIFETIME.result);
  }
}

const exported: GuildCommand = {
  help: { section: "channel", tier: "everyone", gate: joinRefusal },
  data: new SlashCommandBuilder().setName("join").setDescription("봇을 음성 채널에 참가시켜요"),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    // 기동 복원, 음성 연결을 기다리기 전에 "참가하는 중"을 본인에게 먼저 답하고(3초 안에), 저장한 세션을 복원하면 그것을 "불러오는 중"으로 고친다
    const result = await join(
      bot,
      { guild, member, textChannel: channel },
      {
        accepted: acceptWith(interaction, replies.joining()),
        restoring: () => interaction.editReply(post(replies.restoring())).catch(unlessGone(log, "/join 자리표시자 갱신")),
      },
    );
    await answer(interaction, result);
  },
};
export default exported;
