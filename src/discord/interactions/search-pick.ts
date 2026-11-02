// /search 결과 화면의 선택 메뉴. custom_id 는 search:pick:검색한 사람. 고른 곡은 /play 와 같은 길로 넣는다(discord/commands/play 의 playOnReply).
// 결과 메시지를 "추가하는 중" 으로 고쳐 쓰므로 그 메시지에 예약한 삭제를 먼저 멈춘다(실패 안내가 곧바로 지워지지 않게)

import type { StringSelectMenuInteraction } from "discord.js";
import * as errors from "../../ui/text/ko/errors.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import { post } from "../../ui/frame.ts";
import { SEARCH, customId, partsOf } from "../../ui/custom-ids.ts";
import { noticeSelf, stopExpiry } from "../../ui/delivery.ts";
import { pickOfOption } from "../../ui/search-results.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { pickUrl, readPick } from "../../rules/search-pick.ts";
import { playOnReply } from "../commands/play.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";

async function handleSearchPick(interaction: StringSelectMenuInteraction<"cached">, bot: BotContext) {
  const [userId] = partsOf(interaction.customId).rest;
  if (userId !== interaction.user.id) return await noticeSelf(interaction, errors.notice("search-owner-only"));
  const value = interaction.values[0] ?? "";
  const pick = readPick(pickOfOption(value));
  if (!pick) return await noticeSelf(interaction, errors.notice("unknown-interaction"));

  // 곡 추가 경로. /play, /search 와 같은 검사
  const permErr = checkAdd(interaction.member) || checkSummon(interaction.member);
  if (permErr) return await noticeSelf(interaction, errors.notice(permErr));

  stopExpiry(interaction.message.id);
  // 항목 이름은 `번호. 제목`(메뉴에 실린 대로)
  const label = interaction.component.options.find((option) => option.value === value)?.label;
  const title = label ? label.replace(/^\d+\. /, "") : null;
  await playOnReply(interaction, bot, { query: pickUrl(pick), placeholder: searchText.addingTrack(title), source: "/search 결과", show: (view) => interaction.update(post(view)) });
}

const routes: Route[] = [route("select", customId(SEARCH, "pick", ""), handleSearchPick)];

export { routes };
