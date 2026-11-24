import { SlashCommandBuilder } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "commands" });
import { showFailureWith } from "../../ui/failure-notice.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import { requestPlayback, type Entrance } from "../../usecases/add-tracks.ts";
import { interactionResponder } from "../../usecases/responders.ts";
import { offerOnInteraction } from "../interactions/playlist-more-handler.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { frame, noticeFrame, reply } from "../../ui/frame.ts";
import type { PermissionDenied } from "../../usecases/permissions.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { HelpEntry } from "../../ui/help-lines.ts";
import type { ChatInputCommandInteraction, ContainerBuilder, GuildMember, StringSelectMenuInteraction } from "discord.js";
import type { BotContext } from "../../app/bot-context.ts";
import { noticeMs, noticeSelf, replaceSelf, unlessGone } from "../../ui/delivery.ts";
import { privateText } from "../../ui/language.ts";
import { L } from "../../infra/log/text.ts";

/** 곡을 찾아 넣는 명령. /play와 /playfirst는 이름(문구도 이름으로 찾는다), 권한, 넣을 위치만 다르다 */
type PlayOptions = {
  name: "play" | "playfirst";
  help: HelpEntry;
  /** 막으면 안내 문장 */
  permission: (member: GuildMember) => Promise<PermissionDenied | null> | PermissionDenied | null;
  insertFirst?: boolean;
};

/**
 * 찾을 것(검색어, 링크)으로 곡을 넣고 이 상호작용의 답 메시지로 알린다. 권한은 호출부가 이미 보았다.
 * placeholder: 찾는 동안 본인에게 보일 줄, source: 요청이 들어온 입구, show: 자리표시자를 보이는 법(기본은 새 답. 검색 결과 메뉴는 그 메시지를 고친다)
 */
async function playOnReply(interaction: ChatInputCommandInteraction<"cached"> | StringSelectMenuInteraction<"cached">, bot: BotContext, { query, placeholder, source, insertFirst = false, show = (view) => interaction.reply(reply(view)) }: { query: string; placeholder: string; source: Entrance; insertFirst?: boolean; show?: (view: ContainerBuilder) => Promise<unknown> }) {
  const { member, guild, channel } = interaction;
  // 자리표시자는 본인에게만. Components V2여야 이 자리표시자를 안내, 메뉴로 고칠 수 있다
  await show(frame({ body: placeholder }));
  // 여기서부터 예외를 던지면 자리표시자를 오류로 바꾼다
  showFailureWith(interaction, (notice) => replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)));

  const result = await requestPlayback(bot, {
    guild,
    requester: member,
    query,
    textChannel: channel,
    voiceChannel: member.voice.channel ?? null,
    responder: interactionResponder(interaction),
    source,
    insertFirst,
  });

  if (!result.success) {
    const failed = addFailureMessage(privateText(interaction), result);
    return await replaceSelf(interaction, noticeFrame(failed), noticeMs(failed));
  }
  // 담은 안내는 모두에게 따로 갔다. 자리표시자는 더 넣기 메뉴로 고치거나 삭제한다
  if (result.more && (await offerOnInteraction(interaction, result.more, result.player))) return;
  await interaction.deleteReply().catch(unlessGone(log, L.commands.placeholderDelete()));
}

function playCommand({ name, help, permission, insertFirst = false }: PlayOptions): GuildCommand {
  return {
    name,
    help,
    data: (C) =>
      new SlashCommandBuilder()
        .setName(name)
        .setDescription(C[name].description)
        .addStringOption((option) => option.setName("query").setDescription(C[name].options.query.description).setRequired(true)),

    async execute(interaction, bot) {
      const query = interaction.options.getString("query", true);
      const permErr = await permission(interaction.member);
      if (permErr) return await noticeSelf(interaction, privateText(interaction).errors.notice(permErr));
      await playOnReply(interaction, bot, { query, placeholder: privateText(interaction).search.searching(query), source: `/${name}`, insertFirst });
    },
  };
}

// 곡 추가는 전 계층 가능. 봇 동작 중에는 동일 음성 채널 규칙, 유휴 시에는 소환 가능 여부
const exported = playCommand({
  help: { section: "play", tier: "everyone" },
  name: "play",
  permission: (member) => checkAdd(member) || checkSummon(member),
});
export default exported;
export { playCommand, playOnReply };
