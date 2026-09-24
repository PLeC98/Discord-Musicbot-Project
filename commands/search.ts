import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../config.ts";
import * as YouTube from "../src/sources/youtube/index.ts";
import * as S from "../src/ui/strings.ts";
import { checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction, Client, GuildMember } from "discord.js";
import type { TrackInfo } from "../src/player/track.ts";

async function validateRequest(member: GuildMember) {
  // 검색 후 선택은 곡 추가 경로. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부
  const permErr = checkAdd(member) || checkSummon(member);
  if (permErr) return { success: false, message: permErr };
  return { success: true };
}

/** 검색 결과를 기억해 둔 것. 버튼(이벤트)이 메시지 id 로 찾아 고른 곡을 넣는다 */
type SearchRecord = { userId: string; query: string; results: TrackInfo[]; timestamp: number };

async function showSearchMenu(interaction: Pick<ChatInputCommandInteraction, "editReply" | "user" | "client">, results: TrackInfo[], query: string) {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 "${query}" 검색 결과`)
    .setColor(config.bot.embedColor)
    .setDescription("번호 버튼을 눌러 노래를 선택하세요.")
    .setFooter({ text: `${results.length}개의 결과` })
    .setTimestamp();

  const maxResults = Math.min(results.length, 9);
  for (let index = 0; index < maxResults; index++) {
    const result = results[index];
    const title = result.title || "알 수 없는 제목";
    const uploader = result.artist || "알 수 없는 채널";
    const duration = formatDuration(result?.duration);
    const value = `👤 ${uploader} • ⏱️ ${duration}`;

    embed.addFields({
      name: `${index + 1}. ${title}`,
      value,
      inline: false,
    });
  }

  // 버튼 생성 (2행, 최대 4+5개)
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();

  // 노래 9개 + 취소 1개 = 최대 버튼 10개
  let hasSecondRow = false;

  for (let i = 0; i < maxResults; i++) {
    const button = new ButtonBuilder()
      .setCustomId(`search_select_${i}`)
      .setLabel(`${i + 1}`)
      .setStyle(ButtonStyle.Secondary);

    // 첫 4개 버튼은 첫 번째 행에, 나머지는 두 번째 행에 배치 (최대 5개)
    if (i < 4) {
      row1.addComponents(button);
    } else if (i < 9) {
      row2.addComponents(button);
      hasSecondRow = true;
    }
  }

  const cancelButton = new ButtonBuilder().setCustomId("search_cancel").setLabel("취소").setStyle(ButtonStyle.Danger).setEmoji("❌");

  row1.addComponents(cancelButton);

  const components = [row1];
  if (hasSecondRow && row2.components.length > 0) {
    components.push(row2);
  }

  const message = await interaction.editReply({
    embeds: [embed],
    components: components,
  });

  // 검색 결과를 메시지 ID로 키잉해 임시 저장. 사용자 ID 키는 같은 사용자의
  // 재검색이 이전 메시지의 버튼과 뒤섞이는 문제가 있었음(감사 M-08).
  // userId는 버튼 처리에서 요청자 본인 확인용
  const client = interaction.client;
  if (!client.searchResults) client.searchResults = new Map();
  client.searchResults.set(message.id, {
    userId: interaction.user.id,
    query: query,
    results: results,
    timestamp: Date.now(),
  });

  // 5분 후 정리. 메시지별 키라 다른 검색의 타이머와 간섭하지 않음
  const timer = setTimeout(
    () => {
      client.searchResults?.delete(message.id);
    },
    5 * 60 * 1000,
  );
  timer.unref?.();
}

function formatDuration(seconds: number | null | undefined, unknownLabel = "알 수 없음") {
  if (!seconds || seconds === 0) return unknownLabel;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
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

    try {
      await interaction.deferReply();

      // 기본 검사
      const validationResult = await validateRequest(member);
      if (!validationResult.success) {
        return await interaction.editReply({
          content: validationResult.message,
        });
      }

      // 검색 수행
      const results = await search(query, 9);

      if (!results || results.length === 0) {
        return await interaction.editReply({
          content: "❌ 검색 결과가 없습니다!",
        });
      }

      await showSearchMenu(interaction, results, query);
    } catch (error) {
      await interaction.editReply({
        content: S.ERR_PROCESSING,
      });
    }
  },
};
export default exported;
export { exported as "module.exports" };
export { validateRequest, showSearchMenu, formatDuration };
export type { SearchRecord };
