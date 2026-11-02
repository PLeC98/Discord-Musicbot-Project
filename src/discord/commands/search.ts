import { LIVE_MARK, formatDuration } from "../../ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type AutocompleteInteraction, type ApplicationCommandOptionChoiceData } from "discord.js";
import * as YouTube from "../../sources/youtube/index.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../../app/bot-context.ts";
import type { TrackInfo } from "../../player/track.ts";
import { isHttpLink, isKnownSiteHost } from "../../rules/links.ts";
import { pickUrl, pickValue, readPick } from "../../rules/search-pick.ts";
import { autocompleteBudget } from "../../rules/autocomplete-budget.ts";
import { graphemeLength } from "../../rules/clip-text.ts";
import type { TextSearchResult } from "../../sources/youtube/text-search.ts";
import { playOnReply } from "./play.ts";
import { requesterName } from "../../usecases/add-tracks.ts";
import { SEARCH, customId } from "../../ui/custom-ids.ts";
import logger from "../../infra/log/logger.ts";
import { colorOf } from "../../ui/colors.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { LIFETIME, expireSelf, noticeInstead, noticeSelf } from "../../ui/delivery.ts";
const log = logger.child({ category: "player" });

const MAX_RESULTS = 9;
/** 자동완성 곡 후보 수(맨 위 줄은 따로) */
const CHOICES = 10;
/** 이보다 짧은 검색어(글자 수)는 찾지 않고 맨 위 줄만 */
const MIN_QUERY = 2;

// 링크는 검색하지 않는다. 글자 그대로 찾으면 엉뚱한 결과가 나온다(공유 링크의 ?si=, 스포티파이 주소). /play 처럼 곡 넣기로 넘긴다
const isLink = (query: string) => isHttpLink(query) || isKnownSiteHost(query);

// 선택한 결과는 버튼이 싣는다(요청자, 번호, 영상 ID). 처리는 src/discord/interactions/button-handler 의 검색 처리
async function showSearchMenu(interaction: Pick<ChatInputCommandInteraction, "editReply" | "user">, results: TrackInfo[], query: string) {
  // 버튼이 영상 ID 를 싣는다. 검색 결과는 늘 ID 가 있지만 없는 것은 선택할 수 없으니 뺀다
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
    .setEmoji(buttonEmoji("cancel"));

  const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(0, 4), cancelButton)];
  if (buttons.length > 4) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(4)));

  await interaction.editReply({ embeds: [embed], components });
}

/** 유튜브 검색과 시계. 생략하면 진짜(테스트가 가짜를 넘긴다) */
type SearchDeps = { search?: (query: string) => Promise<TextSearchResult>; now?: () => number };

// ms 안에 끝나면 그 결과. 넘기면 late, 던지면 failed(실패는 검색 모듈이 남겼다). 끝나지 않은 검색은 계속 돌아 기억을 채운다
function within<T>(work: Promise<T>, ms: number): Promise<{ value: T } | { missed: "late" | "failed" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ missed: "late" }>((resolve) => (timer = setTimeout(() => resolve({ missed: "late" }), ms)));
  const done = work.then(
    (value) => ({ value }),
    () => ({ missed: "failed" as const }),
  );
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

/** 자동완성 선택지: 맨 위 줄(입력한 글자로 결과 화면)과 곡 후보. 연령 인증 안내만 왔으면 그 문장을 맨 위 줄 이름으로 */
function choicesOf(query: string, found: TextSearchResult | null): ApplicationCommandOptionChoiceData<string>[] {
  if (found?.gated) {
    const gated = errors.notice("search-age-gated");
    return [{ name: `${gated.title} ${gated.body ?? ""}`.trim(), value: query }];
  }
  const top = { name: searchText.resultsChoice(query), value: query };
  // 이름이 같은 후보(다시 올린 영상 등)는 하나만. 겹치면 디스코드가 응답 전체를 거절할 수 있다
  const names = new Set([top.name]);
  const songs = (found?.tracks ?? []).flatMap((track) => {
    const name = searchText.songChoice({ title: track.title, artist: track.artist, length: track.isLive ? LIVE_MARK : formatDuration(track.duration, searchText.unknownLength()) });
    if (!track.id || names.has(name)) return [];
    names.add(name);
    return [{ name, value: pickValue({ platform: "youtube", id: track.id }) }];
  });
  return [top, ...songs.slice(0, CHOICES)];
}

const exported: GuildCommand & {
  execute(interaction: ChatInputCommandInteraction<"cached">, bot: BotContext, deps?: SearchDeps): unknown;
  autocomplete(interaction: AutocompleteInteraction<"cached">, bot: BotContext, deps?: SearchDeps): Promise<unknown>;
} = {
  help: { section: "explore", tier: "everyone" },
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("곡을 검색해요")
    // 자동완성 맨 위 줄의 값이 입력한 글자다. 선택지 값은 100자까지라 넘치면 그 줄을 만들 수 없다
    .addStringOption((option) => option.setName("query").setNameLocalizations({ ko: "검색어" }).setDescription("검색할 키워드").setRequired(true).setMaxLength(100).setAutocomplete(true)),

  async autocomplete(interaction, _bot, { search = YouTube.searchText, now = Date.now }: SearchDeps = {}) {
    const query = interaction.options.getFocused().trim();
    // 100자를 넘으면 맨 위 줄의 값이 될 수 없다(입력 칸 상한이 100자라 보통 오지 않는다)
    if (!query || query.length > 100 || isLink(query)) return await interaction.respond([]);
    if (graphemeLength(query) < MIN_QUERY) return await interaction.respond(choicesOf(query, null));

    const started = now();
    const outcome = await within(search(query), autocompleteBudget(interaction.createdTimestamp, started));
    // 마감 안에 못 찾았으면 앞부분이 같은 이전 검색의 결과라도
    const found = "value" in outcome ? outcome.value : YouTube.rememberedPrefix(query);
    const choices = choicesOf(query, found);
    const missed = "missed" in outcome ? `, ${outcome.missed === "late" ? "마감 넘김" : "검색 실패"}(${found ? "앞 검색어의 결과" : "결과 없음"})` : "";
    log.debug({ sub: "search" }, `자동완성: "${query}" → ${found?.gated ? "연령 인증 안내" : `후보 ${choices.length - 1}개`}${missed} | ${now() - started}ms`);
    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction<"cached">, bot: BotContext, { search = YouTube.searchText }: SearchDeps = {}) {
    // 붙여 넣은 링크 앞뒤의 공백(NBSP, 전각 공백 포함)은 걷는다. 링크 판정이 다듬은 글자를 받는다
    const query = interaction.options.getString("query", true).trim();
    const member = interaction.member;

    // 검색 뒤 선택은 곡 추가 경로. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부. 거절은 본인에게만
    const permErr = checkAdd(member) || checkSummon(member);
    if (permErr) return noticeSelf(interaction, errors.notice(permErr));

    // 자동완성에서 고른 곡(값이 곡을 가리킨다)과 링크는 /play 처럼 바로 넣는다
    const pick = readPick(query);
    if (pick) return await playOnReply(interaction, bot, { query: pickUrl(pick), placeholder: searchText.addingTrack(YouTube.rememberedVideo(pick.id)?.title ?? null), source: "/search 자동완성" });
    if (isLink(query)) return await playOnReply(interaction, bot, { query, placeholder: searchText.searching(query), source: "/search" });

    // 검색이 던지면(네트워크, 봇 감지 등) 진입점이 남기고 이 답 메시지에 그 종류로 알린다
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 자동완성이 방금 찾은 것이 있으면 그 목록 그대로(검색할 때마다 순서가 조금씩 바뀐다)
    const found = YouTube.rememberedSearch(query) ?? (await search(query));
    log.info({ sub: "play" }, `곡 검색: /search | ${requesterName(member)} | "${query}" → ${found.gated ? "연령 인증 안내" : found.tracks.length ? `결과 ${found.tracks.length}개` : "결과 없음"}`);

    if (found.gated) return await noticeInstead(interaction, errors.notice("search-age-gated"));
    if (found.tracks.length === 0) return await noticeInstead(interaction, errors.notice("no-search-results"));

    await showSearchMenu(interaction, found.tracks, query);
    expireSelf(interaction, LIFETIME.menu);
  },
};
export default exported;
export { showSearchMenu };
