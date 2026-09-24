import { SlashCommandBuilder } from "discord.js";
import addTracks from "../src/usecases/addTracks.ts";
const { toRequester } = addTracks;
import responders from "../src/usecases/responders.ts";
const { interactionResponder } = responders;
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import permissions from "../src/usecases/permissions.ts";
const { checkControl } = permissions;

const exported = {
  data: new SlashCommandBuilder().setName("dashboard").setDescription("Repost the now-playing panel at the bottom of this channel").setDescriptionLocalizations({ ko: "현재 재생 중 패널을 채널 하단에 띄웁니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    // 패널을 호출 채널로 옮기는 부작용이 있는 명령어. 봇 전용 채널이 지정된 서버: 그 채널에서만 사용 가능하되 전원 허용 (패널이 항상 전용 채널에 유지됨)
    //  미지정 서버(삭제된 채널 포함): 어디서나 사용 가능하되 DJ 계층 필요
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (botChannelId && guild.channels.cache.has(botChannelId)) {
      if (channel.id !== botChannelId) {
        return interaction.reply({ content: `❌ 이 명령어는 <#${botChannelId}> 채널에서만 사용할 수 있습니다!`, flags: [1 << 6] });
      }
    } else {
      const permErr = await checkControl(member);
      if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });
    }

    const player = client.players.get(guild.id);
    // 곡이 없으면 끝난 패널을 이 채널에 다시 올린다
    if (!player?.currentTrack) {
      await interaction.deferReply({ flags: [1 << 6] });
      await client.musicEmbedManager.repostIdlePanel(guild, channel);
      return interaction.deleteReply().catch(() => {});
    }

    // 옛 패널은 새로 올릴 때 기록을 보고 치운다
    player.nowPlayingMessage = null;
    player.nowPlayingWebhook = null;

    client.musicEmbedManager.stopProgressUpdate(guild.id);

    player.textChannel = channel;

    await client.musicEmbedManager.createNewMusicEmbed(player, player.currentTrack, toRequester(member), interactionResponder(interaction, client.musicEmbedManager), { reuse: false });
  },
};
export default exported;
export { exported as "module.exports" };
