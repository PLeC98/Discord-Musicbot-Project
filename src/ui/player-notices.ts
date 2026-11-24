// 플레이어가 알린 일(notice)을 그 서버의 텍스트 채널에 응답 템플릿(ui/frame)으로 보낸다. 플레이어는 무슨 일인지 코드로만 알린다.

import type { ContainerBuilder } from "discord.js";
import { errorMessage } from "./error-messages.ts";
import { formatDuration } from "./format.ts";
import { LIFETIME, noticeMs } from "./delivery.ts";
import { frame, noticeFrame, post } from "./frame.ts";
import { publicText } from "./language.ts";
import type { BotText } from "./text/index.ts";
import { labelOf } from "../config/genres.ts";
import { scheduleDelete } from "./transient-messages.ts";
import type { Player } from "../player/player.ts";
import type { Notice } from "./text/notice.ts";
import type { Notices, NoticeCode } from "../player/events.ts";

type Shown = { view: ContainerBuilder; ms: number };

// 오류, 경고 안내는 그 수준의 수명으로
const shown = (notice: Notice): Shown => ({ view: noticeFrame(notice), ms: noticeMs(notice) });

// 안내 본문 끝에 한 줄을 더한다
const withLine = (notice: Notice, line: string | null): Notice =>
  line
    ? {
        ...notice,
        body: notice.body
          ? `${notice.body}
${line}`
          : line,
      }
    : notice;

// 코드 → 화면과 수명. T는 그 서버의 언어(채널에 보내는 공개 메시지)
const VIEW: { [C in NoticeCode]: (T: BotText, detail: Notices[C]) => Shown } = {
  // 장르 목록이 바뀌기 전에 저장된 세션 등
  "autoplay-unknown-genre": (T, { genre }) => shown(T.notices.autoplayUnknownGenre(genre)),
  // 저장된 세션의 장르가 그 사이 쓸 소스를 잃었다(키를 삭제했다 등)
  // 장르는 식별자로 온다. 보이는 것은 라벨(autoplay-unknown-genre는 라벨이 없어 식별자 그대로)
  "autoplay-genre-unusable": (T, { genre, keys }) => shown(T.notices.autoplayGenreUnusable(labelOf(genre), keys)),
  "autoplay-gave-up": (T, { genre }) => shown(T.notices.autoplayGaveUp(labelOf(genre))),
  // 곡을 못 틀어 다음 곡으로 넘긴다(곡 탓). 대기열의 같은 곡도 뺐으면 그 수
  "skipped-after-error": (T, { error, removed = 0 }) => shown(withLine(errorMessage(T, error), removed > 0 ? T.notices.copiesRemoved(removed) : null)),
  // 연달아 넘긴 곡 중 하나씩 알리지 않고 모은 것
  "skipped-more": (T, { count }) => shown(T.notices.skippedMore(count)),
  // 그 곡에서 일시정지해 뒀다(player.park). 재생 버튼으로 다시 연다
  parked: (T, why) => shown(why.kind === "environment" ? withLine(errorMessage(T, why.error), T.notices.parkedLine()) : why.kind === "failures" ? T.notices.parkedFailures(why.count) : T.notices.parkedDropped()),
  // /join 없이 새로 틀어 앞 플레이어가 남긴 세션을 지웠다
  "saved-session-replaced": (T, { count }) => shown(T.notices.savedSessionReplaced(count)),
  // 스테이지에 청중으로 들어왔다(player/voice-link)
  "stage-requested": (T) => shown(T.notices.stageRequested()),
  "stage-cannot-speak": (T) => shown(T.notices.stageCannotSpeak()),
  restored: (T, { title, atSec, paused }) => {
    const t = T.notices.restored(title, formatDuration(atSec, "0:00"), paused);
    return { view: frame({ icon: t.icon, title: t.title, body: t.body }), ms: LIFETIME.glance };
  },
};

async function sendNotice<C extends NoticeCode>(player: Pick<Player, "textChannel">, code: C, detail: Notices[C]) {
  if (typeof player.textChannel?.send !== "function") return;
  const notice = VIEW[code]?.(publicText(player.textChannel.guildId), detail);
  if (!notice) return;
  const sent = await player.textChannel.send(post(notice.view));
  scheduleDelete(sent, notice.ms);
}

export { sendNotice };
