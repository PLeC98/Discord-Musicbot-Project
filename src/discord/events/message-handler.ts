import { Events } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { requestPlayback } from "../../usecases/add-tracks.ts";
import { channelResponder } from "../../usecases/responders.ts";
import { scheduleDelete } from "../../ui/transient-messages.ts";
import { offerOnChannel } from "../../usecases/playlist-more.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { frame, noticeFrame, post } from "../../ui/frame.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import type { ClientEvent } from "../../app/main.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { noticeMs, unlessGone } from "../../ui/delivery.ts";
import { isShuttingDown } from "../../infra/shutdown-state.ts";

const USER_MESSAGE_DELETE_MS = 1500; // 곡 요청 메시지를 삭제하기까지

const exported: ClientEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,

  async execute(bot, message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const guildId = message.guild.id;
    const content = message.content.trim();
    if (!content) return;

    // 전용 채널의 글만 받는다
    const botChannelId = await GuildSettingsManager.getBotChannel(guildId);
    if (!botChannelId || message.channel.id !== botChannelId) return;

    const member = message.member;
    if (!member) return; // 서버 메시지인데 멤버가 없다(웹훅 등)

    // 종료 중이면 곡을 찾지 않고 알린다(새 재생을 시작하지 않는다). 디스코드 연결을 닫은 뒤면 알림도 못 보낸다
    if (isShuttingDown()) {
      await message.reply(post(noticeFrame(errors.notice("bot-shutting-down")))).catch((error: unknown) => log.debug(`종료 중 안내 전송 실패: ${messageOf(error)}`));
      return;
    }

    // 곡 추가 권한: 봇 동작 중에는 동일 음성 채널 규칙(서버 관리자 면제), 유휴 시에는 소환 가능 여부. /play와 동일 기준
    const permError = checkAdd(member) || checkSummon(member);
    if (permError) {
      const refused = errors.notice(permError);
      const reply = await message.reply(post(noticeFrame(refused)));
      scheduleDelete(reply, noticeMs(refused));
      scheduleDelete(message, noticeMs(refused));
      return;
    }

    // 채널을 깔끔하게 유지하기 위해 사용자 메시지를 삭제한다. 곧바로 삭제하면 보낸 사람의 디스코드 앱이 보냄 확인을 받기 전에 삭제되어
    // 삭제할 수도 없는 유령 메시지로 남는다(앱을 다시 시작해야 사라진다). 잠깐 뒤에 삭제한다
    scheduleDelete(message, USER_MESSAGE_DELETE_MS);

    // "검색 중" 자리표시자. 처음부터 Components V2 로 보내야 뒤의 현재 재생 메시지 흐름과 맞는다
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const loadingMsg = await message.channel.send(post(frame({ body: searchText.searching(preview) })));

    const responder = channelResponder(message.channel, () => loadingMsg.delete().catch(unlessGone(log, "자리표시자 삭제")));

    try {
      const result = await requestPlayback(bot, {
        guild: message.guild,
        requester: member,
        query: content,
        textChannel: message.channel,
        voiceChannel: member.voice.channel ?? null,
        responder,
        source: "전용채널",
      });

      // 곡 찾기, 재생 시작 실패를 알린다. 알리지 않으면 왜 안 되는지 알 수 없다
      if (!result.success) {
        await responder.dismissPlaceholder();
        const failed = addFailureMessage(result);
        const errMsg = await message.channel.send(post(noticeFrame(failed)));
        scheduleDelete(errMsg, noticeMs(failed));
      } else if (result.more) {
        await offerOnChannel(message.channel, result.more, result.player, member.id);
      }
    } catch (error) {
      log.error({ sub: "message" }, "메시지 처리 오류:", error);
      await responder.dismissPlaceholder();
      const failed = errors.notice("processing-failed");
      const errMsg = await message.channel.send(post(noticeFrame(failed)));
      scheduleDelete(errMsg, noticeMs(failed));
    }
  },
};
export default exported;
