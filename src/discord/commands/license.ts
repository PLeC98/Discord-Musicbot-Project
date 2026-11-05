import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../../config/index.ts";
import type { AnywhereCommand } from "../../app/command-loader.ts";
import { colorOf } from "../../ui/colors.ts";
import * as infoText from "../../ui/text/ko/info.ts";
import { LIFETIME, selfOnly, toSelf } from "../../ui/delivery.ts";

const exported: AnywhereCommand = {
  help: { section: "info", tier: "everyone" },
  anywhere: true,
  data: new SlashCommandBuilder().setName("license").setDescription("라이선스와 소스 코드 저장소를 표시해요"),

  async execute(interaction) {
    const UPSTREAM_REPO = "https://github.com/umutxyp/MusicBot";
    const projectRepo = config.bot.projectRepo;
    const sourceRepo = config.bot.sourceRepo;

    const lines = [`• [Copyright (c) 2025 umutxyp](${UPSTREAM_REPO}), **MIT License**`, `• [Copyright (C) 2026 PLeC](${projectRepo}), **GNU AGPL-3.0-or-later**`];

    // SOURCE_REPO_URL로 개조본 저장소를 지정했을 때만 셋째 줄을 단다(기본값은 본 프로젝트 저장소라 위 줄과 겹친다)
    if (sourceRepo !== projectRepo) {
      const label = sourceRepo.match(/github\.com\/([^/]+)/)?.[1] || "Modified Source";
      lines.push(`• [${label}](${sourceRepo}): **GNU AGPL-3.0-or-later**`);
    }

    const t = infoText.license(lines);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setColor(colorOf("brand"))
      .setDescription(t.description)
      .addFields({ ...t.license, inline: false }, { ...t.summary, inline: false }, { ...t.fullText, inline: false })
      .setFooter({ text: t.footer })
      .setTimestamp();

    await toSelf(interaction, selfOnly({ embeds: [embed] }), LIFETIME.screen);
  },
};
export default exported;
