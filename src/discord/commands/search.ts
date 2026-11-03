// /search: 입력하는 동안 자동완성으로 곡 후보를 보이고, 선택하면 /play 와 같은 길로 넣는다. 선택하지 않고 보내면 결과 화면(카드와 선택 메뉴)에서 선택한다.
// 결과는 유튜브와 스포티파이를 섞는다(rules/search-mix). 결과 화면의 선택은 discord/interactions/search-pick 이 받는다

import { SlashCommandBuilder, type AutocompleteInteraction, type ApplicationCommandOptionChoiceData, type ChatInputCommandInteraction } from "discord.js";
import * as YouTube from "../../sources/youtube/index.ts";
import * as Spotify from "../../sources/spotify.ts";
import type { SpotifyTrack } from "../../sources/spotify.ts";
import type { TextSearchResult } from "../../sources/youtube/text-search.ts";
import type { TrackInfo } from "../../player/track.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { requesterName } from "../../usecases/add-tracks.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import { isHttpLink, isKnownSiteHost } from "../../rules/links.ts";
import { pickUrl, pickValue, readPick } from "../../rules/search-pick.ts";
import { autocompleteBudget } from "../../rules/autocomplete-budget.ts";
import { graphemeLength } from "../../rules/clip-text.ts";
import { mixCounts, uniqueBy } from "../../rules/search-mix.ts";
import logger from "../../infra/log/logger.ts";
import { LIVE_MARK, formatDuration } from "../../ui/format.ts";
import { frame, noticeFrame, reply } from "../../ui/frame.ts";
import { showFailureWith } from "../../ui/failure-notice.ts";
import { searchResultsView, type ResultRow } from "../../ui/search-results.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { LIFETIME, expireMessage, noticeMs, noticeSelf, replaceSelf } from "../../ui/delivery.ts";
import { playOnReply } from "./play.ts";
const log = logger.child({ category: "player" });

/** 자동완성 곡 후보 수(맨 위 줄은 따로)와 결과 화면의 줄 수 */
const CHOICES = 10;
/** 그중 스포티파이 곡 몫(유튜브가 모자라면 더 채운다). 0 이면 섞지 않고, 유튜브가 연령 인증으로 막았을 때만 스포티파이로 채운다 */
const SPOTIFY_SHARE: number = 3;
/** 이보다 짧은 검색어(글자 수)는 찾지 않고 맨 위 줄만 */
const MIN_QUERY = 2;
/**
 * 같은 사람의 다음 입력을 기다리는 시간(ms). 이 안에 다음 요청이 오면 앞 요청은 찾지 않고 기억으로만 답한다.
 * 디스코드는 입력을 1초 남짓으로 묶어 보낸다. 3초 마감에서 이만큼 쓰고도 검색(0.5초 안팎)이 들어간다
 */
const SETTLE_MS = 1000;
/** 결과 화면이 스포티파이를 기다리는 시간(ms). 넘기면 유튜브만 보인다(익명 상태를 처음 추출하면 수 초 걸린다) */
const SPOTIFY_RESULTS_MS = 4000;
// 사람마다 마지막 자동완성 요청의 번호
const latestRequest = new Map<string, number>();
let requestCount = 0;

// 링크는 검색하지 않는다. 글자 그대로 찾으면 엉뚱한 결과가 나온다(공유 링크의 ?si=, 스포티파이 주소). /play 처럼 곡 넣기로 넘긴다
const isLink = (query: string) => isHttpLink(query) || isKnownSiteHost(query);

/** 유튜브 검색, 스포티파이 검색과 그 준비, 시계, 기다리기. 생략하면 진짜(테스트가 가짜를 넘긴다) */
type SearchDeps = {
  search?: (query: string) => Promise<TextSearchResult>;
  searchSpotify?: (query: string) => Promise<SpotifyTrack[]>;
  spotifyReady?: () => boolean;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
};
/** 찾은 것. youtube 는 못 찾았으면 null */
type Found = { youtube: TextSearchResult | null; spotify: SpotifyTrack[] };
const NOTHING: Found = { youtube: null, spotify: [] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const depsOf = (deps: SearchDeps): Required<SearchDeps> => ({ search: YouTube.searchText, searchSpotify: Spotify.searchTracks, spotifyReady: Spotify.searchReady, now: Date.now, wait: sleep, ...deps });

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

const gatedSentence = () => {
  const gated = errors.notice("search-age-gated");
  return `${gated.title} ${gated.body ?? ""}`.trim();
};

const lengthOf = (track: { duration: number; isLive?: boolean }) => (track.isLive ? LIVE_MARK : formatDuration(track.duration, searchText.unknownLength()));

/** 섞을 곡: 연령 인증으로 막힌 유튜브는 없는 것으로 */
const youtubeOf = (found: Found): TrackInfo[] => (found.youtube?.gated ? [] : (found.youtube?.tracks ?? []));

// ── 자동완성 ──

/** 자동완성에 들어온 글자 → 찾을 검색어. 찾을 것이 없으면(빈 것, 링크, 100자 넘음, 선택한 연령 인증 줄의 문장) null */
function searchable(typed: string): string | null {
  if (typed.startsWith(gatedSentence().slice(0, 12))) return null;
  const query = searchText.queryOfTyped(typed);
  // 100자를 넘으면 맨 위 줄의 값이 될 수 없다(입력란 상한이 100자라 보통 오지 않는다)
  return !query || query.length > 100 || isLink(query) ? null : query;
}

/** 기다리는 동안 같은 사람의 다음 요청이 오지 않았으면 참 */
async function settled(user: string, wait: (ms: number) => Promise<unknown>) {
  const mine = ++requestCount;
  latestRequest.set(user, mine);
  await wait(SETTLE_MS);
  if (latestRequest.get(user) !== mine) return false;
  latestRequest.delete(user);
  return true;
}

// 이미 찾은 검색어의 결과. 스포티파이를 찾을 수 있고 섞는 몫이 있으면(또는 유튜브가 막았으면) 스포티파이도 기억에 있어야 한다
function remembered(query: string, spotifyReady: boolean): Found | null {
  const youtube = YouTube.rememberedSearch(query);
  if (!youtube) return null;
  if (!spotifyReady || (SPOTIFY_SHARE === 0 && !youtube.gated)) return { youtube, spotify: Spotify.rememberedTracks(query) ?? [] };
  const spotify = Spotify.rememberedTracks(query);
  return spotify ? { youtube, spotify } : null;
}

// 앞부분이 같은 이전 검색의 결과(찾지 않을 때, 마감 안에 못 찾았을 때)
const rememberedPrefix = (query: string): Found => ({ youtube: YouTube.rememberedPrefix(query), spotify: Spotify.rememberedTracksPrefix(query) ?? [] });

/**
 * 유튜브와 스포티파이를 함께 찾는다. 스포티파이는 준비돼 있을 때만(아니면 준비를 시작하고 유튜브만).
 * 섞지 않을 때는 유튜브가 연령 인증으로 막았을 때만 남은 시간 안에 스포티파이를 찾는다. missed: 마감을 넘기거나 실패한 쪽
 */
async function findBoth(query: string, deps: Required<SearchDeps>, budget: number): Promise<{ found: Found; missed: string[] }> {
  const started = deps.now();
  const missed: string[] = [];
  const spotifyOf = (ms: number) => (deps.spotifyReady() ? within(deps.searchSpotify(query), ms) : null);
  let spotifyWork = SPOTIFY_SHARE > 0 ? spotifyOf(budget) : null;
  const youtubeOutcome = await within(deps.search(query), budget);
  const youtube = "value" in youtubeOutcome ? youtubeOutcome.value : YouTube.rememberedPrefix(query);
  if ("missed" in youtubeOutcome) missed.push(`유튜브 ${youtubeOutcome.missed === "late" ? "마감 넘김" : "실패"}`);
  if (!spotifyWork && youtube?.gated) spotifyWork = spotifyOf(budget - (deps.now() - started));
  const spotifyOutcome = spotifyWork ? await spotifyWork : null;
  if (spotifyOutcome && "missed" in spotifyOutcome) missed.push(`스포티파이 ${spotifyOutcome.missed === "late" ? "마감 넘김" : "실패"}`);
  const spotify = spotifyOutcome && "value" in spotifyOutcome ? spotifyOutcome.value : (Spotify.rememberedTracksPrefix(query) ?? []);
  return { found: { youtube, spotify }, missed };
}

/**
 * 자동완성 선택지: 맨 위 줄(입력한 글자로 결과 화면)과 곡 후보(유튜브 다음 스포티파이).
 * 유튜브가 연령 인증 안내만 주고 스포티파이 곡도 없으면 그 문장을 맨 위 줄 이름으로
 */
function choicesOf(query: string, found: Found): ApplicationCommandOptionChoiceData<string>[] {
  if (found.youtube?.gated && found.spotify.length === 0) return [{ name: gatedSentence(), value: query }];
  const top = { name: searchText.resultsChoice(query), value: query };
  const youtube = youtubeOf(found).flatMap((track) => (track.id ? [{ name: searchText.songChoice({ title: track.title, artist: track.artist, length: lengthOf(track) }), value: pickValue({ platform: "youtube", id: track.id }) }] : []));
  const spotify = found.spotify.flatMap((track) => (track.id ? [{ name: searchText.songChoice({ title: track.title, artist: track.artist, length: lengthOf(track), spotify: true }), value: pickValue({ platform: "spotify", id: track.id }) }] : []));
  // 이름이 같은 후보(다시 올린 영상, 여러 앨범에 실린 곡)는 하나만. 겹치면 디스코드가 응답 전체를 거절할 수 있다
  const songs = uniqueBy([top, ...youtube, ...spotify], (one) => one.name).slice(1);
  const counts = mixCounts(songs.filter((one) => one.value.startsWith("yt:")).length, songs.filter((one) => one.value.startsWith("sp:")).length, { total: CHOICES, spotifyShare: SPOTIFY_SHARE });
  return [top, ...songs.filter((one) => one.value.startsWith("yt:")).slice(0, counts.youtube), ...songs.filter((one) => one.value.startsWith("sp:")).slice(0, counts.spotify)];
}

// ── 결과 화면 ──

/** 결과 화면이 쓸 것: 자동완성이 방금 찾은 것(검색할 때마다 순서가 조금씩 바뀐다)이 있으면 그것. 유튜브 실패는 던진다 */
async function findForResults(query: string, deps: Required<SearchDeps>): Promise<Found> {
  const spotifyWork = SPOTIFY_SHARE > 0 ? (Spotify.rememberedTracks(query) ?? within(deps.searchSpotify(query), SPOTIFY_RESULTS_MS)) : null;
  const youtube = YouTube.rememberedSearch(query) ?? (await deps.search(query));
  const outcome = await (spotifyWork ?? (youtube.gated ? within(deps.searchSpotify(query), SPOTIFY_RESULTS_MS) : null));
  const spotify = Array.isArray(outcome) ? outcome : outcome && "value" in outcome ? outcome.value : [];
  return { youtube, spotify };
}

/** 결과 화면의 줄: 유튜브 다음 스포티파이. 같은 곡(제목, 가수, 길이가 같다)은 하나만 */
function resultRows(found: Found): ResultRow[] {
  const keyOf = (one: ResultRow) => `${one.platform}\u0000${one.title ?? ""}\u0000${one.artist ?? ""}\u0000${lengthOf(one)}`;
  const youtube = uniqueBy(
    youtubeOf(found).flatMap((track): ResultRow[] => (track.id ? [{ platform: "youtube", id: track.id, title: track.title, artist: track.artist, duration: track.duration, isLive: track.isLive, pageUrl: track.pageUrl }] : [])),
    keyOf,
  );
  const spotify = uniqueBy(
    found.spotify.flatMap((track): ResultRow[] => (track.id ? [{ platform: "spotify", id: track.id, title: track.title, artist: track.artist, duration: track.duration, pageUrl: track.pageUrl }] : [])),
    keyOf,
  );
  const counts = mixCounts(youtube.length, spotify.length, { total: CHOICES, spotifyShare: SPOTIFY_SHARE });
  return [...youtube.slice(0, counts.youtube), ...spotify.slice(0, counts.spotify)];
}

/** 찾아서 결과 화면을 보인다. 결과가 없거나 유튜브가 연령 인증으로 막고 스포티파이도 없으면 그 안내 */
async function showResults(interaction: ChatInputCommandInteraction<"cached">, query: string, deps: Required<SearchDeps>) {
  // "검색 중" 은 본인에게만. 처음부터 Components V2 로 답해야 결과 화면, 안내로 고칠 수 있다. 여기서부터 던지면 이 메시지를 오류로 바꾼다
  await interaction.reply(reply(frame({ body: searchText.searching(query) })));
  showFailureWith(interaction, (notice) => replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)));

  const found = await findForResults(query, deps);
  const rows = resultRows(found);
  const spotifyCount = rows.filter((row) => row.platform === "spotify").length;
  log.info({ sub: "play" }, `곡 검색: /search | ${requesterName(interaction.member)} | "${query}" → ${rows.length ? `유튜브 ${rows.length - spotifyCount}, 스포티파이 ${spotifyCount}` : "결과 없음"}${found.youtube?.gated ? "(유튜브 연령 인증 안내)" : ""}`);

  if (rows.length === 0) {
    const notice = errors.notice(found.youtube?.gated ? "search-age-gated" : "no-search-results");
    return await replaceSelf(interaction, noticeFrame(notice), noticeMs(notice));
  }
  const message = await interaction.editReply(searchResultsView({ query, rows, gated: Boolean(found.youtube?.gated), userId: interaction.user.id }));
  expireMessage(message.id, () => interaction.deleteReply(), LIFETIME.search);
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

  async autocomplete(interaction, _bot, deps: SearchDeps = {}) {
    const all = depsOf(deps);
    const query = searchable(interaction.options.getFocused().trim());
    if (!query) return await interaction.respond([]);
    if (graphemeLength(query) < MIN_QUERY) return await interaction.respond(choicesOf(query, NOTHING));

    // 이미 찾은 검색어(글자를 지워 돌아온 것 등)는 기다리지 않는다
    const known = remembered(query, all.spotifyReady());
    if (known) return await interaction.respond(choicesOf(query, known));

    if (!(await settled(interaction.user.id, all.wait))) {
      log.debug({ sub: "search" }, `자동완성: "${query}" → 다음 입력이 와서 찾지 않음`);
      return await interaction.respond(choicesOf(query, rememberedPrefix(query)));
    }

    const started = all.now();
    const { found, missed } = await findBoth(query, all, autocompleteBudget(interaction.createdTimestamp, started));
    const choices = choicesOf(query, found);
    const spotifyCount = choices.filter((one) => one.value.startsWith("sp:")).length;
    const shown = choices.length === 1 && found.youtube?.gated ? "연령 인증 안내" : `유튜브 ${choices.length - 1 - spotifyCount}, 스포티파이 ${spotifyCount}`;
    log.debug({ sub: "search" }, `자동완성: "${query}" → ${shown}${missed.length ? `(${missed.join(", ")})` : ""} | ${all.now() - started}ms`);
    await interaction.respond(choices);
  },

  async execute(interaction, bot, deps: SearchDeps = {}) {
    const all = depsOf(deps);
    // 붙여 넣은 링크 앞뒤의 공백(NBSP, 전각 공백 포함)은 걷는다. 링크 판정이 다듬은 글자를 받는다
    const query = interaction.options.getString("query", true).trim();
    const member = interaction.member;

    // 검색 뒤 선택은 곡 추가 경로. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부. 거절은 본인에게만
    const permErr = checkAdd(member) || checkSummon(member);
    if (permErr) return noticeSelf(interaction, errors.notice(permErr));

    // 자동완성에서 선택한 곡(값이 곡을 가리킨다)과 링크는 /play 처럼 바로 넣는다
    const pick = readPick(query);
    if (pick) return await playOnReply(interaction, bot, { query: pickUrl(pick), placeholder: searchText.addingTrack((pick.platform === "spotify" ? Spotify.rememberedTrack(pick.id) : YouTube.rememberedVideo(pick.id))?.title ?? null), source: "/search 자동완성" });
    if (isLink(query)) return await playOnReply(interaction, bot, { query, placeholder: searchText.searching(query), source: "/search" });

    await showResults(interaction, query, all);
  },
};
export default exported;
