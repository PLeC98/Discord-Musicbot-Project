'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('license')
        .setDescription('Shows license information and source code location')
        .setDescriptionLocalizations({ ko: '라이선스 정보와 소스 코드 위치를 보여줍니다' }),

    async execute(interaction) {
        const sourceRepo = config.bot.sourceRepo;
        const upstreamRepo = config.bot.upstreamRepo;

        const embed = new EmbedBuilder()
            .setTitle('📜 라이선스 정보')
            .setColor(config.bot.embedColor)
            .setDescription(
                '이 봇은 오픈 소스 소프트웨어입니다.\n' +
                '네트워크를 통해 이 봇과 상호작용하는 모든 사용자는 ' +
                'GNU AGPL-3.0에 따라 소스 코드를 받을 권리가 있습니다.'
            )
            .addFields(
                {
                    name: '🧩 라이선스 구조',
                    value:
                        `• 원본 베이스: [umutxyp/MusicBot](${upstreamRepo}) — **MIT License**\n` +
                        '• 이 포크의 수정·추가분: Copyright (C) 2026 PLeC — **AGPL-3.0-or-later**\n' +
                        '• 결합 저작물 전체에는 AGPL-3.0 조건이 적용됩니다',
                    inline: false,
                },
                {
                    name: '📂 소스 코드',
                    value: sourceRepo
                        ? `[${sourceRepo.replace(/^https?:\/\//, '')}](${sourceRepo})`
                        : '소스 저장소가 아직 공개되지 않았습니다. 봇 운영자에게 문의하세요.',
                    inline: false,
                },
                {
                    name: '📄 라이선스 전문',
                    value: '저장소의 `LICENSE`(AGPL-3.0) / `LICENSE-MIT`(MIT) / `NOTICE.md`(구조 설명) 파일을 참조하세요.',
                    inline: false,
                },
            )
            .setFooter({ text: 'GNU AGPL-3.0-or-later • MIT' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });
    },
};
