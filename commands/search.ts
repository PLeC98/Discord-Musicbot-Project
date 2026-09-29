import { formatDuration } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import * as YouTube from "../src/sources/youtube/index.ts";
import { checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { TrackInfo } from "../src/player/track.ts";
import { requesterName } from "../src/usecases/addTracks.ts";
import { SEARCH, customId } from "../src/ui/customIds.ts";
import logger from "../src/infra/log/logger.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as searchText from "../src/ui/text/search.ts";
import * as errors from "../src/ui/text/errors.ts";
const log = logger.child({ category: "player" });

const MAX_RESULTS = 9;

// 고른 결과는 버튼이 싣는다(요청자 · 번호 · 영상 ID). 처리는 interactions/buttonHandler 의 검색 처리
async function showSearchMenu(interaction: Pick<ChatInputCommandInteraction, "editReply" | "user">, results: TrackInfo[], query: string) {
  // 버튼이 영상 ID 를 싣는다. 검색 결과는 늘 ID 가 있지만 없는 것은 고를 수 없으니 뺀다
  const shown = results.flatMap((track) => (track.id ? [{ track, videoId: track.id }] : [])).slice(0, MAX_RESULTS);

  const t = searchText.results(query, shown.length);
  const embed = new EmbedBuilder().setTitle(t.title).setColor(colorOf("brand")).setDescription(t.description).setFooter({ text: t.footer }).setTimestamp();

  shown.forEach(({ track }, index) => {
    const field = searchText.result(index + 1, { title: track.title, uploader: track.artist, length: formatDuration(track.duration, searchText.unknownLength()) });
    embed.addFields({ ...field, inline: false });
  });

  // 첫 줄에 번호 4개와 취소, 둘째 줄에 나머지 번호 5개(한 줄에 5개까지)
  const userId = interaction.user.id;
  const buttons = shown.map(({ videoId }, index) =>
    new ButtonBuilder()
      .setCustomId(customId(SEARCH, "pick", userId, index + 1, videoId))
      .setLabel(`${index + 1}`)
      .setStyle(ButtonStyle.Secondary),
  );
  const cancelButton = new ButtonBuilder()
    .setCustomId(customId(SEARCH, "cancel", userId))
    .setLabel(t.cancel)
    .setStyle(ButtonStyle.Danger)
    .setEmoji("❌");

  const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(0, 4), cancelButton)];
  if (buttons.length > 4) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(4)));

  await interaction.editReply({ embeds: [embed], components });
}

/** 유튜브 검색. 생략하면 진짜(시험이 가짜를 넘긴다) */
type SearchDeps = { search?: (query: string, limit: number) => Promise<TrackInfo[]> };

const exported: GuildCommand & { execute(interaction: ChatInputCommandInteraction<"cached">, client: Client<true>, deps?: SearchDeps): unknown } = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search and select music on YouTube")
    .setDescriptionLocalizations({
      ko: "유튜브에서 음악을 검색/선택합니다",
    })
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Music name or artist to search")
        .setDescriptionLocalizations({
          ko: "검색할 음악 이름 또는 아티스트",
        })
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction<"cached">, _client: Client<true>, { search = (query: string, limit: number) => YouTube.search(query, limit) }: SearchDeps = {}) {
    const query = interaction.options.getString("query", true);
    const member = interaction.member;

    // 검색 뒤 고르기는 곡 추가 경로. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부. 거절은 본인에게만
    const permErr = checkAdd(member) || checkSummon(member);
    if (permErr) return interaction.reply({ content: permErr, flags: MessageFlags.Ephemeral });

    // 검색이 던지면(네트워크 · 봇 감지 등) 입구가 남기고 이 답 자리에 그 종류로 알린다
    await interaction.deferReply();

    const results = await search(query, MAX_RESULTS);
    log.info({ sub: "play" }, `곡 검색: /search | ${requesterName(member)} | "${query}" → ${results?.length ? `결과 ${results.length}개` : "결과 없음"}`);

    if (!results || results.length === 0) {
      return await interaction.editReply({
        content: errors.noSearchResults(),
      });
    }

    await showSearchMenu(interaction, results, query);
  },
};
export default exported;
export { showSearchMenu };
