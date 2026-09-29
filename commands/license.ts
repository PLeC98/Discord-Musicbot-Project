import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import config from "../config.ts";
import type { AnywhereCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as infoText from "../src/ui/text/info.ts";

const exported: AnywhereCommand = {
  anywhere: true,
  data: new SlashCommandBuilder().setName("license").setDescription("Shows license information and source code location").setDescriptionLocalizations({ ko: "라이선스 정보와 소스 코드 위치를 보여줍니다" }),

  async execute(interaction) {
    const UPSTREAM_REPO = "https://github.com/umutxyp/MusicBot";
    const projectRepo = config.bot.projectRepo;
    const sourceRepo = config.bot.sourceRepo;

    const lines = [`• [Copyright (c) 2025 umutxyp](${UPSTREAM_REPO}), **MIT License**`, `• [Copyright (C) 2026 PLeC](${projectRepo}), **GNU AGPL-3.0-or-later**`];

    // SOURCE_REPO_URL로 개조본 저장소를 지정한 경우에만 세 번째 줄 추가 (기본값은 본 프로젝트 저장소라서 그대로 표시하면 위 줄과 중복됨)
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

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
