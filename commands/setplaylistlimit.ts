// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import config from "../config.ts";

// 재생목록을 넣을 때 한 번에 들어가는 곡 수. 남은 곡은 "더 넣기"로 이어 넣고, 그쪽은 대기열 상한만 본다.
// 위쪽 끝은 대기열 상한을 따라 바뀌므로 명령 옵션에 못박지 않고 실행할 때 검사한다.
const exported = {
  data: new SlashCommandBuilder()
    .setName("setplaylistlimit")
    .setDescription("Set how many songs a playlist adds at once")
    .setDescriptionLocalizations({ ko: "재생목록을 넣을 때 한 번에 들어가는 곡 수를 정합니다" })
    .addIntegerOption((option) => option.setName("count").setDescription("Songs per add (leave empty to see the current value)").setDescriptionLocalizations({ ko: "한 번에 넣을 곡 수 (비우면 지금 값을 보여 줍니다)" }).setMinValue(1).setRequired(false))
    .addStringOption((option) => option.setName("action").setDescription("Set, or reset to the default").setDescriptionLocalizations({ ko: "설정하거나 기본값으로 되돌립니다" }).addChoices({ name: "Set", value: "set" }, { name: "Reset", value: "reset" }).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { min, max } = GuildSettingsManager.playlistAddLimits();
    const action = interaction.options.getString("action") || "set";
    const count = interaction.options.getInteger("count");

    if (action === "reset") {
      if (!(await GuildSettingsManager.setPlaylistAddMax(guildId, null))) return failed(interaction);
      return interaction.reply({ embeds: [card("🔧 기본값으로 되돌렸어요", `재생목록을 넣으면 한 번에 **${GuildSettingsManager.resolvePlaylistAddMax(guildId)}곡**씩 들어가요.`)] });
    }

    if (count === null) {
      const stored = await GuildSettingsManager.getPlaylistAddMax(guildId);
      const current = GuildSettingsManager.resolvePlaylistAddMax(guildId);
      return interaction.reply({
        embeds: [card("📃 재생목록 한 번에 넣는 곡 수", `지금은 **${current}곡**이에요${stored === null ? " (기본값)" : ""}.\n\`/setplaylistlimit count:<곡 수>\`로 바꿀 수 있어요 (${min}~${max}곡).`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (count < min || count > max) {
      const why = config.bot.maxQueueSize > 0 && max === config.bot.maxQueueSize ? ` 대기열 상한(${config.bot.maxQueueSize}곡)보다 클 수 없어요.` : "";
      return interaction.reply({ content: `❌ ${min}~${max}곡 사이로 정해 주세요.${why}`, flags: MessageFlags.Ephemeral });
    }

    if (!(await GuildSettingsManager.setPlaylistAddMax(guildId, count))) return failed(interaction);
    return interaction.reply({ embeds: [card("✅ 재생목록 한 번에 넣는 곡 수를 바꿨어요", `이제 재생목록을 넣으면 한 번에 **${count}곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.`)] });
  },
};
export default exported;
export { exported as "module.exports" };

function card(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(config.bot.embedColor).setTimestamp();
}

function failed(interaction) {
  return interaction.reply({ content: "❌ 설정을 저장하지 못했어요.", flags: MessageFlags.Ephemeral });
}
