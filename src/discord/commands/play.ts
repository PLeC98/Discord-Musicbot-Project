import { SlashCommandBuilder } from "discord.js";
import { showFailureWith } from "../../ui/failure-notice.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import { requestPlayback } from "../../usecases/add-tracks.ts";
import { interactionResponder } from "../../usecases/responders.ts";
import { offerOnInteraction } from "../../usecases/playlist-more.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { frame, noticeFrame, reply } from "../../ui/frame.ts";
import type { PermissionDenied } from "../../usecases/permissions.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { HelpEntry } from "../../ui/help-lines.ts";
import type { GuildMember } from "discord.js";
import { noticeMs, noticeSelf, replaceSelf } from "../../ui/delivery.ts";

/** 곡을 찾아 넣는 명령. /play 와 /playfirst 는 이름 · 설명 · 권한 · 넣을 자리만 다르다 */
type PlayOptions = {
  name: string;
  description: string;
  ko: string;
  help: HelpEntry;
  /** 막으면 안내 문장 */
  permission: (member: GuildMember) => Promise<PermissionDenied | null> | PermissionDenied | null;
  insertFirst?: boolean;
};

function playCommand({ name, description, ko, help, permission, insertFirst = false }: PlayOptions): GuildCommand {
  return {
    help,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setDescriptionLocalizations({ ko })
      .addStringOption((option) =>
        option
          .setName("query")
          .setNameLocalizations({ ko: "곡" })
          .setDescription("Song name, artist, YouTube/Spotify/SoundCloud URL or direct link")
          .setDescriptionLocalizations({
            ko: "지원하는 플랫폼이나 미디어 파일 링크, 유튜브 검색어",
          })
          .setRequired(true),
      ),

    async execute(interaction, client) {
      const query = interaction.options.getString("query", true);
      const { member, guild, channel } = interaction;

      const permErr = await permission(member);
      if (permErr) return await noticeSelf(interaction, errors.notice(permErr));

      // "검색 중" 은 본인에게만. 처음부터 Components V2 로 응답해야 이 자리를 안내 · 메뉴로 고칠 수 있다
      await interaction.reply(reply(frame({ body: searchText.searching(query) })));
      // 여기서부터 던지면 "검색 중" 자리를 오류로 바꾼다
      showFailureWith(interaction, (notice) => replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)));

      const result = await requestPlayback(client, {
        guild,
        requester: member,
        query,
        textChannel: channel,
        voiceChannel: member.voice.channel ?? null,
        responder: interactionResponder(interaction),
        source: `/${name}`,
        insertFirst,
      });

      if (!result.success) {
        const failed = addFailureMessage(result);
        return await replaceSelf(interaction, noticeFrame(failed), noticeMs(failed));
      }
      // 담은 안내는 모두에게 따로 갔다. "검색 중" 자리는 더 넣기 메뉴로 고치거나 지운다
      if (result.more && (await offerOnInteraction(interaction, result.more, result.player))) return;
      await interaction.deleteReply().catch(() => {
        /* 이미 지워졌다 */
      });
    },
  };
}

// 곡 추가는 전 계층 가능. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부
const exported = playCommand({
  help: { section: "play", tier: "everyone" },
  name: "play",
  description: "Plays music - Supports YouTube, Spotify, SoundCloud or direct links",
  ko: "곡을 재생해요",
  permission: (member) => checkAdd(member) || checkSummon(member),
});
export default exported;
export { playCommand };
