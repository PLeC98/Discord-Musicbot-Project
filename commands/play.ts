import { SlashCommandBuilder } from "discord.js";
import { showFailureWith } from "../src/ui/failureNotice.ts";
import { addFailureMessage } from "../src/ui/errorMessages.ts";
import * as searchText from "../src/ui/text/search.ts";
import { requestPlayback } from "../src/usecases/addTracks.ts";
import { interactionResponder } from "../src/usecases/responders.ts";
import { offerOnInteraction } from "../src/usecases/playlistMore.ts";
import { checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import * as errors from "../src/ui/text/errors.ts";
import { frame, noticeFrame, noticeReply, post } from "../src/ui/frame.ts";
import type { PermissionDenied } from "../src/ui/text/errors.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { GuildMember } from "discord.js";

/** 곡을 찾아 넣는 명령. /play 와 /playfirst 는 이름 · 설명 · 권한 · 넣을 자리만 다르다 */
type PlayOptions = {
  name: string;
  description: string;
  ko: string;
  /** 막으면 안내 문장 */
  permission: (member: GuildMember) => Promise<PermissionDenied | null> | PermissionDenied | null;
  insertFirst?: boolean;
};

function playCommand({ name, description, ko, permission, insertFirst = false }: PlayOptions): GuildCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setDescriptionLocalizations({ ko })
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Song name, artist, YouTube/Spotify/SoundCloud URL or direct link")
          .setDescriptionLocalizations({
            ko: "곡 이름, 아티스트, 유튜브/스포티파이/사운드클라우드 URL, 직접 링크",
          })
          .setRequired(true),
      ),

    async execute(interaction, client) {
      const query = interaction.options.getString("query", true);
      const { member, guild, channel } = interaction;

      const permErr = await permission(member);
      if (permErr) return await interaction.reply(noticeReply(errors.permission(permErr)));

      // 처음부터 Components V2로 응답. 초기 메시지에 IS_COMPONENTS_V2 플래그가 서야 이후 편집이 가능하다
      await interaction.reply(post(frame({ body: searchText.searching(query) })));
      // 여기서부터 던지면 "검색 중" 자리를 오류로 바꾼다
      showFailureWith(interaction, (notice) => interaction.editReply(post(noticeFrame(notice))));

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
        return await interaction.editReply(post(noticeFrame(addFailureMessage(result))));
      }
      if (result.more) await offerOnInteraction(interaction, result.more, result.player);
    },
  };
}

// 곡 추가는 전 계층 가능. 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부
const exported = playCommand({
  name: "play",
  description: "Plays music - Supports YouTube, Spotify, SoundCloud or direct links",
  ko: "음악을 재생합니다",
  permission: (member) => checkAdd(member) || checkSummon(member),
});
export default exported;
export { playCommand };
