import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { GuildCommand } from "../../app/command-loader.ts";
import { reply } from "../../ui/frame.ts";
import { panel } from "../interactions/settings-panel-handler.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";

// 서버 설정 한 화면(DJ 역할 · SponsorBlock · 연령 제한 콘텐츠). 고르면 바로 저장한다.
// 처리는 src/discord/interactions/settings-panel-handler.ts (customId: setting:*). 봇 전체에서 끈 기능의 부분은 화면을 그릴 때 빠진다(명령은 늘 있다)
const exported: GuildCommand = {
  help: { section: "channel", tier: "moderator" },
  // 설명에 부분 이름을 적지 않는다. 운영자가 끈 기능의 부분은 화면에 없어 그때그때 다르다
  data: new SlashCommandBuilder().setName("setting").setDescription("Open server settings").setDescriptionLocalizations({ ko: "서버 설정을 열어요" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await toSelf(interaction, reply(await panel(interaction.guild)), LIFETIME.screen);
  },
};
export default exported;
