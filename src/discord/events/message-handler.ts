import { Events, type Message } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { checkAdd, checkSummon, type PermissionDenied } from "../../usecases/permissions.ts";
import { requestPlayback } from "../../usecases/add-tracks.ts";
import { channelResponder } from "../../usecases/responders.ts";
import { scheduleDelete } from "../../ui/transient-messages.ts";
import { offerOnChannel } from "../../usecases/playlist-more.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { frame, noticeFrame, post } from "../../ui/frame.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import type { ClientEvent } from "../../app/main.ts";
import { noticeMs } from "../../ui/delivery.ts";
import { canPost, canPostPanel, canReply } from "../../ui/channels.ts";

const USER_MESSAGE_DELETE_MS = 1500; // 곡 요청 메시지를 삭제하기까지
// 글 · 파일을 올릴 수 없다고 이미 알린 전용 채널(메시지마다 남기지 않는다)
const unpostable = new Set<string>();

// 봇이 패널을 올릴 수 있는 전용 채널인가(전용 채널의 권한이 바뀌었을 수 있다). ok · text-only: 글만 올릴 수 있다(까닭을 답한다) · closed: 글도 못 올린다(답할 길이 없다).
// 못 올린다는 로그는 그 채널마다 한 번만
function panelState(channel: Message<true>["channel"]) {
  const { id } = channel;
  if (canPostPanel(channel)) {
    unpostable.delete(id);
    return "ok" as const;
  }
  if (!unpostable.has(id)) log.warn({ sub: "message" }, `전용 채널 ${id} 에 글 · 파일을 올릴 권한이 없어 곡 요청을 받지 않습니다`);
  unpostable.add(id);
  return canPost(channel) ? ("text-only" as const) : ("closed" as const);
}

// 이 전용 채널에서 곡 요청을 받을 수 있나. 글만 올릴 수 있으면 까닭을 답하고 받지 않는다
async function accepts(message: Message<true>) {
  const state = panelState(message.channel);
  if (state === "text-only") await refuse(message, "permission-text");
  return state === "ok";
}

// 곡 추가를 막은 까닭을 답한다. 답장은 메시지 기록 보기가 들어 없으면 채널 메시지로. 답과 요청을 그 수준의 수명 뒤 삭제한다
async function refuse(message: Message<true>, code: PermissionDenied | "permission-text") {
  const refused = errors.notice(code);
  const payload = post(noticeFrame(refused));
  const reply = await (canReply(message.channel) ? message.reply(payload) : message.channel.send(payload));
  scheduleDelete(reply, noticeMs(refused));
  scheduleDelete(message, noticeMs(refused));
}

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
    if (!(await accepts(message))) return;

    const member = message.member;
    if (!member) return; // 서버 메시지인데 멤버가 없다(웹훅 등)

    // 곡 추가 권한: 봇 동작 중에는 재적 규칙(모더레이터 면제), 유휴 시에는 소환 가능 여부. /play와 동일 기준
    const permError = checkAdd(member) || checkSummon(member);
    if (permError) return refuse(message, permError);

    // 채널을 깔끔하게 유지하기 위해 사용자 메시지를 삭제한다. 곧바로 삭제하면 보낸 사람의 디스코드 앱이 보냄 확인을 받기 전에 삭제되어
    // 삭제할 수도 없는 유령 메시지로 남는다(앱을 다시 시작해야 사라진다). 잠깐 뒤에 삭제한다
    scheduleDelete(message, USER_MESSAGE_DELETE_MS);

    // 초기 CV2 검색 자리표시자. 생성 시점부터 CV2여야 이후 현재 재생 메시지 흐름과 맞는다
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const loadingMsg = await message.channel.send(post(frame({ body: searchText.searching(preview) })));

    const responder = channelResponder(message.channel, () =>
      loadingMsg.delete().catch(() => {
        /* 이미 삭제됐다 */
      }),
    );

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

      // 해석 실패·재생 시작 실패를 사용자에게 알림. 침묵하면 왜 안 되는지 알 수 없다
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
