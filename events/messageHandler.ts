import { Events } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import { checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import { requestPlayback } from "../src/usecases/addTracks.ts";
import { channelResponder } from "../src/usecases/responders.ts";
import { scheduleDelete } from "../src/ui/transientMessages.ts";
import { offerOnChannel } from "../src/usecases/playlistMore.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { frame, noticeFrame, post } from "../src/ui/frame.ts";
import { addFailureMessage } from "../src/ui/errorMessages.ts";
import * as searchText from "../src/ui/text/ko/search.ts";
import type { ClientEvent } from "../src/app/main.ts";

const USER_MESSAGE_DELETE_MS = 1500; // 곡 요청 메시지를 지우기까지

const exported: ClientEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const guildId = message.guild.id;
    const content = message.content.trim();
    if (!content) return;

    // 지정된 봇 채널인지 확인
    const botChannelId = await GuildSettingsManager.getBotChannel(guildId);
    if (!botChannelId || message.channel.id !== botChannelId) return;

    const client = message.client;
    const member = message.member;
    if (!member) return; // 서버 메시지인데 멤버가 없다(웹훅 등)

    // 곡 추가 권한: 봇 동작 중에는 재적 규칙(모더레이터 면제), 유휴 시에는 소환 가능 여부. /play와 동일 기준
    const permError = checkAdd(member) || checkSummon(member);
    if (permError) {
      const reply = await message.reply(post(noticeFrame(errors.permission(permError))));
      scheduleDelete(reply, 5000);
      scheduleDelete(message, 5000);
      return;
    }

    // 채널을 깔끔하게 유지하기 위해 사용자 메시지를 지운다. 곧바로 지우면 보낸 사람의 디스코드 앱이 보냄 확인을 받기 전에 지워져
    // 지울 수도 없는 유령 메시지로 남는다(앱을 다시 켜야 사라진다). 잠깐 뒤에 지운다
    scheduleDelete(message, USER_MESSAGE_DELETE_MS);

    // 초기 CV2 검색 자리표시자. 생성 시점부터 CV2여야 이후 현재 재생 메시지 흐름과 맞는다
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const loadingMsg = await message.channel.send(post(frame({ body: searchText.searching(preview) })));

    const responder = channelResponder(message.channel, () =>
      loadingMsg.delete().catch(() => {
        /* 이미 지워졌다 */
      }),
    );

    try {
      const result = await requestPlayback(client, {
        guild: message.guild,
        requester: member,
        query: content,
        textChannel: message.channel,
        voiceChannel: member.voice.channel ?? null,
        responder,
        source: "전용채널",
      });

      // 해석 실패·재생 시작 실패를 사용자에게 알림. 침묵하면 왜 안 되는지 알 수 없다
      if (!result.success) {
        await responder.dismissPlaceholder();
        const errMsg = await message.channel.send(post(noticeFrame(addFailureMessage(result))));
        scheduleDelete(errMsg, 8000);
      } else if (result.more) {
        await offerOnChannel(message.channel, result.more, result.player, member.id);
      }
    } catch (error) {
      log.error({ sub: "message" }, "메시지 처리 오류:", error);
      await responder.dismissPlaceholder();
      const errMsg = await message.channel.send(post(noticeFrame(errors.processingFailed())));
      scheduleDelete(errMsg, 8000);
    }
  },
};
export default exported;
