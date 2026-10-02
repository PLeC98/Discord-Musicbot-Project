import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import * as settingsText from "../src/ui/text/ko/settings.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, post, reply } from "../src/ui/frame.ts";
import * as screens from "../src/ui/settingsScreens.ts";

// 재생목록을 넣을 때 한 번에 들어가는 곡 수. 남은 곡은 "더 넣기"로 이어 넣고, 그쪽은 대기열 상한만 본다.
// 위쪽 끝은 대기열 상한을 따라 바뀌므로 명령 옵션에 못박지 않고 실행할 때 검사한다.
const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("setplaylistlimit")
    .setDescription("Set how many songs a playlist adds at once")
    .setDescriptionLocalizations({ ko: "재생목록을 넣을 때 한 번에 넣을 곡 수를 정해요" })
    .addIntegerOption((option) => option.setName("count").setDescription("Songs per add (leave empty to see the current value)").setDescriptionLocalizations({ ko: "한 번에 넣을 곡 수 (비우면 현재 설정 값 표시)" }).setMinValue(1).setRequired(false))
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Set, or reset to the default")
        .setDescriptionLocalizations({ ko: "설정 또는 기본값으로 되돌리기" })
        .addChoices({ name: "Set", name_localizations: { ko: "설정" }, value: "set" }, { name: "Reset", name_localizations: { ko: "기본값" }, value: "reset" })
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { min, max } = GuildSettingsManager.playlistAddLimits();
    const action = interaction.options.getString("action") || "set";
    const count = interaction.options.getInteger("count");

    if (action === "reset") {
      if (!(await GuildSettingsManager.setPlaylistAddMax(guildId, null))) return failed(interaction);
      return interaction.reply(post(screens.saved(settingsText.playlistLimitReset(GuildSettingsManager.resolvePlaylistAddMax(guildId)))));
    }

    if (count === null) {
      const stored = await GuildSettingsManager.getPlaylistAddMax(guildId);
      const current = GuildSettingsManager.resolvePlaylistAddMax(guildId);
      return interaction.reply(reply(screens.shown(settingsText.playlistLimitNow({ count: current, isDefault: stored === null, min, max }))));
    }

    if (count < min || count > max) {
      const queueCap = config.bot.maxQueueSize > 0 && max === config.bot.maxQueueSize ? config.bot.maxQueueSize : null;
      return interaction.reply(noticeReply(errors.notice("playlist-limit-out-of-range", { min, max, queueCap })));
    }

    if (!(await GuildSettingsManager.setPlaylistAddMax(guildId, count))) return failed(interaction);
    return interaction.reply(post(screens.saved(settingsText.playlistLimitSet(count))));
  },
};
export default exported;

function failed(interaction: ChatInputCommandInteraction) {
  return interaction.reply(noticeReply(errors.notice("settings-save-failed")));
}
