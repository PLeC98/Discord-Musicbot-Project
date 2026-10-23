import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { interactionResponder } from "../../usecases/responders.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { checkControl, checkPanelChannel } from "../../usecases/permissions.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { DISCORD_LOOK } from "../../ui/mentions.ts";
import { noticeSelf } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "channel", tier: "dj-outside-bot-channel" },
  data: new SlashCommandBuilder().setName("dashboard").setDescription("Repost the now-playing panel at the bottom of this channel").setDescriptionLocalizations({ ko: "재생 패널을 이 채널의 맨 아래에 다시 표시해요" }),

  async execute(interaction, bot) {
    const { guild, member, channel } = interaction;
    if (!channel) return noticeSelf(interaction, errors.notice("processing-failed")); // 캐시에 없는 채널

    // 패널을 호출 채널로 옮기는 부작용이 있는 명령어. 봇 전용 채널이 지정된 서버: 그 채널에서만 사용 가능하되 전원 허용 (패널이 항상 전용 채널에 유지됨)
    //  미지정 서버(삭제된 채널 포함): 어디서나 사용 가능하되 DJ 계층 필요
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (botChannelId && guild.channels.cache.has(botChannelId)) {
      if (channel.id !== botChannelId) {
        return noticeSelf(interaction, errors.notice("only-in-bot-channel", { channelId: botChannelId }, DISCORD_LOOK));
      }
    } else {
      const permErr = await checkControl(member);
      if (permErr) return noticeSelf(interaction, errors.notice(permErr));
    }
    // 패널을 이 채널에 올린다
    const panelErr = await checkPanelChannel(guild, interaction);
    if (panelErr) return noticeSelf(interaction, errors.notice(panelErr));

    const player = bot.players.get(guild.id);
    // 곡이 없으면 끝난 패널을 이 채널에 다시 올린다
    if (!player?.currentTrack) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await bot.panels.repostIdlePanel(guild, channel);
      return interaction.deleteReply().catch(() => {
        /* 상호작용이 이미 닫혔다 */
      });
    }

    player.movePanel(channel);
    bot.panels.stopProgressUpdate(guild.id);

    await bot.panels.postPlaying(player, player.currentTrack, interactionResponder(interaction), { reuse: false });
  },
};
export default exported;
