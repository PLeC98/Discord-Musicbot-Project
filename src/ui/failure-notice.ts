// 처리가 던졌을 때 안내를 어디에 보일지. 남기기와 안내는 상호작용 입구(src/discord/events/interaction-create)가 한다.
// 자리표시자("검색 중" · "처리 중")를 띄운 처리기는 그 자리를 안내로 바꾸는 법을 선언한다. 선언이 없으면 입구의 기본대로

import type { Notice } from "./text/notice.ts";

type Show = (notice: Notice) => Promise<unknown>;

const shows = new WeakMap<object, Show>();

/** 이 상호작용이 던지면 안내를 show 로 보인다 */
function showFailureWith(interaction: object, show: Show) {
  shows.set(interaction, show);
}

/** 선언된 안내 방법. 없으면 null */
function failureShow(interaction: object): Show | null {
  return shows.get(interaction) ?? null;
}

export { showFailureWith, failureShow };
