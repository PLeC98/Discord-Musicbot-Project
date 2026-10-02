// 곡을 담은 안내. /play · /playfirst · 전용 채널 · 검색 고르기 · 재생목록의 남은 곡이 같은 화면(응답 틀)을 쓴다.
// 일부만 담았으면(받을 수 없는 곡을 뺐거나 대기열이 찼다) 머리 줄을 "일부 곡을 추가했어요" 로 바꾸고 까닭을 본문에 이어 적는다. 경고 색

import config from "../../config.ts";
import { frame } from "./frame.ts";
import * as labels from "./text/ko/labels.ts";
import * as queueText from "./text/ko/queue.ts";

/** 일부만 담은 까닭. dropped 대기열이 차서 못 넣은 곡 수, skipped 받을 수 없어 뺀 곡 수, total 출처 전체 곡 수(일부만 받았을 때), queueLimited 자리가 모자라 목록을 덜 받음 */
type AdditionNotice = { dropped?: number; skipped?: number; total?: number | null; queueLimited?: boolean };
/** 담은 곡. collection 은 여러 곡을 담은 출처의 종류(sources/lookup 의 collection 값), null 이면 한 곡. insertFirst 는 대기열 맨 앞에 넣었는지 */
type Added = { tracks: Array<{ title?: string | null }>; collection: string | null; insertFirst?: boolean; notice?: AdditionNotice };

function addedView({ tracks, collection, insertFirst = false, notice = {} }: Added) {
  const { dropped = 0, skipped = 0, total = null, queueLimited = false } = notice;
  const head = queueText.added({ tracks, collection: collection === null ? null : labels.collection(collection), total, first: insertFirst });
  const warnings = queueText.addedWarnings({ dropped, skipped, queueLimited, max: config.bot.maxQueueSize });
  if (!warnings.length) return frame({ title: head.title, body: head.body });
  return frame({ title: queueText.partlyAdded(), body: [head.body, ...warnings].join("\n"), color: "warning" });
}

export { addedView };
export type { Added, AdditionNotice };
