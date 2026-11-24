import { Events } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as guildSettings from "../../store/guild-settings.ts";
import { checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { requestPlayback } from "../../usecases/add-tracks.ts";
import { channelResponder } from "../../usecases/responders.ts";
import { scheduleDelete } from "../../ui/transient-messages.ts";
import { offerOnChannel } from "../interactions/playlist-more-handler.ts";
import { frame, noticeFrame, post } from "../../ui/frame.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import type { ClientEvent } from "../../app/main.ts";
import { describeError, messageOf } from "../../rules/error-kind.ts";
import { noticeMs, unlessGone } from "../../ui/delivery.ts";
import { isShuttingDown } from "../../infra/shutdown-state.ts";
import { readsMessageContent } from "../../infra/gateway-intents.ts";
import { MessageType, type Message } from "discord.js";
import { publicText } from "../../ui/language.ts";
import { L } from "../../infra/log/text.ts";

const USER_MESSAGE_DELETE_MS = 1500; // 곡 요청 메시지를 삭제하기까지
const UNREADABLE_REPEAT_MS = 60_000; // 메시지 내용을 읽지 못한다는 안내를 같은 사람에게 다시 하기까지

// 메시지 내용을 읽지 못한다고 안내한 때. 서버와 사람마다
const toldUnreadable = new Map<string, number>();

/** 검색어: 봇 멘션(<@id>, <@!id>)을 뺀 메시지 내용 */
function queryOf(content: string, botId: string | undefined) {
  const text = botId ? content.replace(new RegExp(`<@!?${botId}>`, "g"), " ") : content;
  return text.replace(/\s+/g, " ").trim();
}

/** 사용자가 보낸 일반 메시지인가(시스템 메시지, 스티커만 있는 메시지는 아니다) */
const isPlainPost = (message: Message) => (message.type === MessageType.Default || message.type === MessageType.Reply) && message.stickers.size === 0;

// 메시지 내용을 읽지 못하는데(Message Content Intent 꺼짐) 전용 채널에 메시지가 왔다. 메시지는 늘 지우고, 같은 사람에게는 일정 간격을 두고 다시 안내한다
async function answerUnreadable(message: Message<true>) {
  scheduleDelete(message, USER_MESSAGE_DELETE_MS);
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (toldUnreadable.get(key) ?? -Infinity) < UNREADABLE_REPEAT_MS) return;
  toldUnreadable.set(key, now);
  for (const [k, at] of toldUnreadable) if (now - at >= UNREADABLE_REPEAT_MS) toldUnreadable.delete(k);
  const notice = publicText(message.guild.id).errors.notice("text-entry-off");
  const reply = await message.reply(post(noticeFrame(notice)));
  scheduleDelete(reply, noticeMs(notice));
}

// 전용 채널에 온 곡 요청(검색어). 받을 메시지가 아니면 null. 내용을 읽지 못하는데 일반 메시지가 왔으면 /play를 쓰라고 안내하고 null
async function requestIn(message: Message<true>) {
  const content = queryOf(message.content, message.client.user?.id);
  // 내용을 읽는데 비었으면(스티커, 첨부만) 할 것이 없다
  if (!content && readsMessageContent()) return null;
  // 전용 채널의 메시지만 받는다
  const botChannelId = await guildSettings.getBotChannel(message.guild.id);
  if (!botChannelId || message.channel.id !== botChannelId) return null;
  // 내용을 읽지 못한다(봇을 멘션한 메시지만 내용이 온다)
  if (!content && isPlainPost(message)) await answerUnreadable(message);
  return content || null;
}

const exported: ClientEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,

  async execute(bot, message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    const content = await requestIn(message);
    if (!content) return;
    // 전용 채널의 답은 채널에 보이므로 서버 언어
    const T = publicText(message.guild.id);

    const member = message.member;
    if (!member) return; // 서버 메시지인데 멤버가 없다(웹훅 등)

    // 종료 중이면 곡을 찾지 않고 알린다(새 재생을 시작하지 않는다). 디스코드 연결을 닫은 뒤면 알림도 못 보낸다
    if (isShuttingDown()) {
      await message.reply(post(noticeFrame(T.errors.notice("bot-shutting-down")))).catch((error: unknown) => {
        if (message.client.token === null) log.debug(L.events.stoppingNoticeFailed({ error: messageOf(error) }));
        else log.warn(L.events.stoppingReplyFailed({ channelId: message.channel.id, error: describeError(error) }));
      });
      return;
    }

    // 곡 추가 권한: 봇 동작 중에는 동일 음성 채널 규칙(서버 관리자 면제), 유휴 시에는 소환 가능 여부. /play와 동일 기준
    const permError = checkAdd(member) || checkSummon(member);
    if (permError) {
      const refused = T.errors.notice(permError);
      const reply = await message.reply(post(noticeFrame(refused)));
      scheduleDelete(reply, noticeMs(refused));
      scheduleDelete(message, noticeMs(refused));
      return;
    }

    // 채널을 깔끔하게 유지하기 위해 사용자 메시지를 삭제한다. 곧바로 삭제하면 보낸 사람의 디스코드 앱이 보냄 확인을 받기 전에 삭제되어
    // 삭제할 수도 없는 유령 메시지로 남는다(앱을 다시 시작해야 사라진다). 잠깐 뒤에 삭제한다
    scheduleDelete(message, USER_MESSAGE_DELETE_MS);

    // "검색 중" 자리표시자. 처음부터 Components V2로 보내야 뒤의 현재 재생 메시지 흐름과 맞는다
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const loadingMsg = await message.channel.send(post(frame({ body: T.search.searching(preview) })));

    const responder = channelResponder(message.channel, () => loadingMsg.delete().catch(unlessGone(log, L.events.placeholderDelete())));

    try {
      const result = await requestPlayback(bot, {
        guild: message.guild,
        requester: member,
        query: content,
        textChannel: message.channel,
        voiceChannel: member.voice.channel ?? null,
        responder,
        source: "bot-channel",
      });

      // 곡 찾기, 재생 시작 실패를 알린다. 알리지 않으면 왜 안 되는지 알 수 없다
      if (!result.success) {
        await responder.dismissPlaceholder();
        const failed = addFailureMessage(T, result);
        const errMsg = await message.channel.send(post(noticeFrame(failed)));
        scheduleDelete(errMsg, noticeMs(failed));
      } else if (result.more) {
        await offerOnChannel(message.channel, result.more, result.player, member.id);
      }
    } catch (error) {
      log.error({ sub: "message" }, L.events.messageHandlingFailed(), error);
      await responder.dismissPlaceholder();
      const failed = T.errors.notice("processing-failed");
      const errMsg = await message.channel.send(post(noticeFrame(failed)));
      scheduleDelete(errMsg, noticeMs(failed));
    }
  },
};
export default exported;
