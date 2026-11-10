import { SlashCommandBuilder, MessageFlags, RESTJSONErrorCodes } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { interactionResponder } from "../../usecases/responders.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { checkControl } from "../../usecases/permissions.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { DISCORD_LOOK } from "../../ui/mentions.ts";
import { noticeSelf, unlessGone } from "../../ui/delivery.ts";
import { canPostPanel } from "../../ui/channels.ts";
import { codeOf } from "../../rules/error-kind.ts";

// 채널 권한이 모자라 패널을 올리지 못한 오류(Missing Access, Missing Permissions)
const PERMISSION_CODES = new Set<unknown>([RESTJSONErrorCodes.MissingAccess, RESTJSONErrorCodes.MissingPermissions]);

const exported: GuildCommand = {
  help: { section: "channel", tier: "dj-outside-bot-channel" },
  data: new SlashCommandBuilder().setName("dashboard").setDescription("재생 패널을 이 채널의 맨 아래에 다시 표시해요"),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    if (!channel) return noticeSelf(interaction, errors.notice("processing-failed")); // 캐시에 없는 채널

    // 패널을 이 채널로 옮기는 명령이다. 전용 채널이 있는 서버는 그 채널에서만 누구나 쓴다(패널이 전용 채널을 떠나지 않는다).
    // 전용 채널이 없는 서버(삭제된 채널 포함)는 어디서나 쓰되 DJ 계층이 필요하다
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (botChannelId && guild.channels.cache.has(botChannelId)) {
      if (channel.id !== botChannelId) {
        return noticeSelf(interaction, errors.notice("only-in-bot-channel", { channelId: botChannelId }, DISCORD_LOOK));
      }
    } else {
      const permErr = await checkControl(member);
      if (permErr) return noticeSelf(interaction, errors.notice(permErr));
    }

    const player = bot.players.get(guild.id);
    // 패널을 올리는 작업(웹훅 조회, 전송, 옛 패널 삭제)이 3초를 넘을 수 있어 먼저 본인 표시로 미뤄 두고, 올린 뒤 지운다
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // 곡이 없으면 끝난 패널을 이 채널에 다시 올린다
    if (!player?.currentTrack) {
      await bot.panels.repostIdlePanel(guild, channel);
      return interaction.deleteReply().catch(unlessGone(log, "/dashboard 응답 삭제"));
    }

    // 패널을 올릴 수 없는 채널이면 옮기지 않는다(옮긴 뒤 올리지 못하면 패널이 갈 곳을 잃는다)
    if (!canPostPanel(channel)) return noticeSelf(interaction, errors.notice("permission-text"));
    player.movePanel(channel);
    bot.panels.stopProgressUpdate(guild.id);

    try {
      await bot.panels.postPlaying(player, player.currentTrack, interactionResponder(interaction), { reuse: false });
    } catch (error) {
      if (PERMISSION_CODES.has(codeOf(error))) return noticeSelf(interaction, errors.notice("permission-text"));
      throw error;
    }
    await interaction.deleteReply().catch(unlessGone(log, "/dashboard 응답 삭제"));
  },
};
export default exported;
