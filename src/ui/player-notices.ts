// 플레이어가 알린 일(notice)을 그 서버의 텍스트 채널에 응답 템플릿(ui/frame)로 보낸다. 플레이어는 무슨 일인지 코드로만 알린다.

import type { ContainerBuilder } from "discord.js";
import { errorMessage } from "./error-messages.ts";
import { formatDuration } from "./format.ts";
import { LIFETIME, noticeMs } from "./delivery.ts";
import { frame, noticeFrame, post } from "./frame.ts";
import * as notices from "./text/ko/notices.ts";
import { labelOf } from "../config/genres.ts";
import { scheduleDelete } from "./transient-messages.ts";
import type { Player } from "../player/player.ts";
import type { Notice } from "./text/notice.ts";
import type { Notices, NoticeCode } from "../player/events.ts";
import { canPost } from "./channels.ts";

type Shown = { view: ContainerBuilder; ms: number };

// 오류 · 경고 안내는 그 수준의 수명으로
const shown = (notice: Notice): Shown => ({ view: noticeFrame(notice), ms: noticeMs(notice) });

// 코드 → 화면과 수명
const VIEW: { [C in NoticeCode]: (detail: Notices[C]) => Shown } = {
  // 장르 목록이 바뀌기 전에 저장된 세션 등
  "autoplay-unknown-genre": ({ genre }) => shown(notices.autoplayUnknownGenre(genre)),
  // 저장된 세션의 장르가 그 사이 쓸 소스를 잃었다(키를 삭제했다 등)
  // 장르는 식별자로 온다. 보이는 것은 라벨(모르는 장르는 라벨이 없어 위는 식별자 그대로)
  "autoplay-genre-unusable": ({ genre, keys }) => shown(notices.autoplayGenreUnusable(labelOf(genre), keys)),
  "autoplay-gave-up": ({ genre }) => shown(notices.autoplayGaveUp(labelOf(genre))),
  // 곡을 못 틀어 다음 곡으로 넘긴다
  "skipped-after-error": ({ error }) => shown(errorMessage(error)),
  // 곡이 연달아 실패해 넘기기를 그만뒀다. 대기열은 남아 있다
  "failed-in-row": ({ count, left }) => shown(notices.failedInRow(count, left)),
  // 스테이지에 청중으로 들어왔다(player/voice-link)
  "stage-requested": () => shown(notices.stageRequested()),
  "stage-cannot-speak": () => shown(notices.stageCannotSpeak()),
  restored: ({ title, atSec, paused }) => {
    const t = notices.restored(title, formatDuration(atSec), paused);
    return { view: frame({ icon: t.icon, title: t.title, body: t.body }), ms: LIFETIME.glance };
  },
};

async function sendNotice<C extends NoticeCode>(player: Pick<Player, "textChannel">, code: C, detail: Notices[C]) {
  const notice = VIEW[code]?.(detail);
  if (!notice || !canPost(player.textChannel)) return;
  const sent = await player.textChannel.send(post(notice.view));
  scheduleDelete(sent, notice.ms);
}

export { sendNotice };
