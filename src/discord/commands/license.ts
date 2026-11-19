// /license: 봇의 라이선스(AGPL-3.0)와 운영 소스 코드를 본인에게만. AGPL은 이 봇을 쓰는 사람에게 지금 돌고 있는 버전의 소스를 받을 길을 열어 두게 한다

import { SlashCommandBuilder } from "discord.js";
import config from "../../config/index.ts";
import type { AnywhereCommand } from "../../app/command-loader.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import { reply } from "../../ui/frame.ts";
import { licenseView } from "../../ui/license-view.ts";

const exported: AnywhereCommand = {
  help: { section: "info", tier: "everyone" },
  anywhere: true,
  data: new SlashCommandBuilder().setName("license").setDescription("라이선스와 소스 코드 저장소를 표시해요"),

  async execute(interaction) {
    await toSelf(interaction, reply(licenseView({ sourceRepo: config.bot.sourceRepo, projectRepo: config.bot.projectRepo })), LIFETIME.screen);
  },
};
export default exported;
