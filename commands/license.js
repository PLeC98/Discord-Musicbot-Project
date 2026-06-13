"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder().setName("license").setDescription("Shows license information and source code location").setDescriptionLocalizations({ ko: "라이선스 정보와 소스 코드 위치를 보여줍니다" }),

  async execute(interaction) {
    const UPSTREAM_REPO = "https://github.com/umutxyp/MusicBot";
    const PLEC_REPO = "https://github.com/PLeC98/Discord-Musicbot-Project";
    const sourceRepo = config.bot.sourceRepo;

    let licenseValue = `• [Copyright (c) 2025 umutxyp](${UPSTREAM_REPO}), **MIT License**\n` + `• [Copyright (C) 2026 PLeC](${PLEC_REPO}), **GNU AGPL-3.0-or-later**`;

    if (sourceRepo) {
      const label = sourceRepo.match(/github\.com\/([^/]+)/)?.[1];
      licenseValue += `\n• [${label}](${sourceRepo}) — **AGPL-3.0-or-later**`;
    }

    const embed = new EmbedBuilder()
      .setTitle("📜 라이선스 정보")
      .setColor(config.bot.embedColor)
      .setDescription("이 봇은 오픈 소스 소프트웨어입니다.\n" + "네트워크를 통해 이 봇과 상호작용하는 모든 사용자는 " + "GNU AGPL-3.0에 따라 소스 코드를 받을 권리가 있습니다.")
      .addFields(
        {
          name: "⚖️ 라이선스",
          value: licenseValue,
          inline: false,
        },
        {
          name: "📑 라이선스 요약",
          value: "• 라이선스가 부여된 저작물 및 수정본(라이선스가 부여된 저작물을 활용한 더 큰 규모의 저작물 포함)의 전체 소스 코드를 동일한 AGPL-3.0 라이선스 하에 공개하는 것을 조건으로 합니다.\n• 저작권 및 라이선스 고지는 반드시 유지되어야 합니다.\n• 기여자는 특허권을 명시적으로 양도합니다\n• 수정된 버전을 사용하여 네트워크를 통해 서비스를 제공하는 경우, 해당 수정된 버전의 전체 소스 코드를 공개해야만 합니다.",
          inline: false,
        },
        {
          name: "📚 라이선스 전문",
          value: "저장소의 `LICENSE`(AGPL-3.0) / `LICENSE-MIT`(MIT) / `LICENSE-NOTICE.md`(구조 설명) 파일을 참조하세요.",
          inline: false,
        },
      )
      .setFooter({ text: "GNU AGPL-3.0-or-later • MIT" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
