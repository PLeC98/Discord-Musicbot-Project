// /search 결과 화면: 카드(헤더 줄, 결과 줄, 연령 인증이면 구분선 아래 푸터)와 카드 밖의 선택 메뉴(재생 패널처럼). 출처는 앱 이모지(동기화 전에는 유니코드 점)

import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from "discord.js";
import { pickValue, type SearchPick } from "../rules/search-pick.ts";
import { SEARCH, customId } from "./custom-ids.ts";
import { LIVE_MARK, formatDuration } from "./format.ts";
import { frame } from "./frame.ts";
import { buttonEmoji, icon } from "./icons.ts";
import * as searchText from "./text/ko/search.ts";

/** 결과 한 곡. platform 은 출처(아이콘, 선택 값) */
type ResultRow = { platform: SearchPick["platform"]; id: string; title: string | null; artist?: string; duration: number; isLive?: boolean; pageUrl: string };

const lengthOf = (row: ResultRow) => (row.isLive ? LIVE_MARK : formatDuration(row.duration, searchText.unknownLength()));

/** 메뉴 항목의 값: 번호와 선택한 곡(같은 곡이 두 번 나와도 값이 겹치지 않게) */
const optionValue = (rank: number, row: ResultRow) => `${rank}:${pickValue({ platform: row.platform, id: row.id })}`;

/** 선택한 항목의 값 → 선택한 곡의 값(번호를 뗀다) */
const pickOfOption = (value: string) => value.slice(value.indexOf(":") + 1);

/** 결과 화면(처음부터 Components V2 로 답한 메시지를 고친다). userId: 고를 수 있는 사람, gated: 유튜브가 연령 인증을 걸어 스포티파이 곡만 있다 */
function searchResultsView({ query, rows, gated, userId }: { query: string; rows: readonly ResultRow[]; gated: boolean; userId: string }) {
  const body = rows.map((row, i) => searchText.resultLine(i + 1, { title: row.title, link: row.pageUrl, source: icon(row.platform), artist: row.artist, length: lengthOf(row) })).join("\n");
  const card = frame({ icon: "search", title: searchText.resultsTitle(query), body, footer: gated ? [searchText.gatedFooter()] : [], divider: true });
  const options = rows.map((row, i) => ({ ...searchText.pickOption(i + 1, { title: row.title, artist: row.artist, length: lengthOf(row) }), value: optionValue(i + 1, row), emoji: buttonEmoji(row.platform) }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(SEARCH, "pick", userId))
    .setPlaceholder(searchText.pickPlaceholder())
    .addOptions(options);
  return { components: [card, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], flags: [MessageFlags.IsComponentsV2] as const };
}

export { searchResultsView, pickOfOption };
export type { ResultRow };
