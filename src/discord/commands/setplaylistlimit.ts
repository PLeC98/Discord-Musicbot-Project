import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as guildSettings from "../../store/guild-settings.ts";
import config from "../../config/index.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { post, reply } from "../../ui/frame.ts";
import * as screens from "../../ui/settings-screens.ts";
import { LIFETIME, noticeSelf, toSelf } from "../../ui/delivery.ts";
import { privateText, publicText } from "../../ui/language.ts";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { L } from "../../infra/log/text.ts";
const log = logger.child({ category: "commands" });

// 재생목록을 넣을 때 한 번에 들어가는 곡 수. 남은 곡은 "더 넣기"로 이어 넣고, 그쪽은 대기열 상한만 본다.
// 위쪽 끝은 대기열 상한을 따라 바뀌므로 명령 옵션에 못박지 않고 실행할 때 검사한다.
const exported: GuildCommand = {
  help: { section: "channel", tier: "server-manager" },
  name: "setplaylistlimit",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("setplaylistlimit")
      .setDescription(C.setplaylistlimit.description)
      .addIntegerOption((option) => option.setName("count").setDescription(C.setplaylistlimit.options.count.description).setMinValue(1).setRequired(false))
      .addStringOption((option) => option.setName("action").setDescription(C.setplaylistlimit.options.action.description).addChoices({ name: C.setplaylistlimit.options.action.choices.set, value: "set" }, { name: C.setplaylistlimit.options.action.choices.reset, value: "reset" }).setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { min, max } = guildSettings.playlistAddLimits();
    const action = interaction.options.getString("action") || "set";
    const count = interaction.options.getInteger("count");

    if (action === "reset") {
      if (!(await saved(interaction, () => guildSettings.setPlaylistAddMax(guildId, null)))) return failed(interaction);
      return interaction.reply(post(screens.saved(publicText(guildId).settings.playlistLimitReset(guildSettings.resolvePlaylistAddMax(guildId)))));
    }

    if (count === null) {
      const stored = await guildSettings.getPlaylistAddMax(guildId);
      const current = guildSettings.resolvePlaylistAddMax(guildId);
      return toSelf(interaction, reply(screens.shown(privateText(interaction).settings.playlistLimitNow({ count: current, isDefault: stored === null, min, max }))), LIFETIME.glance);
    }

    if (count < min || count > max) {
      const queueCap = config.bot.maxQueueSize > 0 && max === config.bot.maxQueueSize ? config.bot.maxQueueSize : null;
      return noticeSelf(interaction, privateText(interaction).errors.notice("playlist-limit-out-of-range", { min, max, queueCap }));
    }

    if (!(await saved(interaction, () => guildSettings.setPlaylistAddMax(guildId, count)))) return failed(interaction);
    return interaction.reply(post(screens.saved(publicText(guildId).settings.playlistLimitSet(count))));
  },
};
export default exported;

// 저장에 실패하면 로그를 남기고 false를 돌려준다
async function saved(interaction: ChatInputCommandInteraction<"cached">, work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    log.error(L.commands.setplaylistlimitSaveFailed({ name: interaction.guild.name, id: interaction.guild.id, field: guildSettings.FIELD_LABEL.playlistAddMax, error: messageOf(error) }));
    return false;
  }
}

function failed(interaction: ChatInputCommandInteraction) {
  return noticeSelf(interaction, privateText(interaction).errors.notice("settings-save-failed"));
}
