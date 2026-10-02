// 재생목록 "더 넣기" 메뉴 · 모달 · 결과의 글자. 수는 여기서 자릿점을 찍는다

import { noticeOf, type Notice } from "../../frame.ts";
import { josa } from "../../../rules/josa.ts";

const fmt = (n: number | null) => Number(n).toLocaleString("ko-KR");

/** 처음 띄우는 메뉴의 머리. collection 은 출처의 이름(labels.collection) */
const offered = (collection: string, total: number, offset: number) => `📃 ${collection}${josa(collection, "은")} 모두 ${fmt(total)}곡이에요. 앞 ${fmt(offset)}곡까지 넣었어요.`;

/** 이어 넣은 결과의 머리 */
function added({ collection, added, skipped, dropped }: { collection: string; added: number; skipped?: number; dropped?: number }) {
  let head = `✅ ${collection}에서 ${fmt(added)}곡을 더 넣었어요.`;
  if (skipped && skipped > 0) head += ` 받을 수 없는 ${fmt(skipped)}곡(미리듣기 · 지역 제한 등)은 뺐어요.`;
  if (dropped && dropped > 0) head += ` 대기열이 가득 차 ${fmt(dropped)}곡은 빠졌어요.`;
  return head;
}
/** 목록을 끝까지 넣었다 */
const finished = (head: string) => `${head} 목록을 끝까지 넣었어요.`;
/** 이어 넣을 것이 남았다. at 은 넣은 데까지의 자리 */
const progressed = (head: string, total: number | null, at: number) => `${head} (${fmt(total)}곡 중 ${fmt(at)}곡까지)`;
/** 자리가 없어 메뉴를 띄우지 않는다 */
const noRoom = (head: string) => `${head}\n대기열이 가득 차 지금은 더 넣을 수 없어요.`;

/** 메뉴. remaining 은 남은 곡 수 */
const menu = (remaining: number) => ({ placeholder: `더 넣기 (남은 ${fmt(remaining)}곡)`, custom: "직접 입력…", stop: "그만 넣기" });
/** n 곡 더 */
const step = (n: number) => `${fmt(n)}곡 더`;
/** 가장 큰 선택지. all 은 남은 곡을 다 넣는지, perClick 은 출처의 한 번 상한에 걸렸는지 */
const capLabel = (cap: number, { all, perClick }: { all: boolean; perClick: boolean }) => (all ? `남은 곡 전부 (${fmt(cap)}곡)` : perClick ? step(cap) : `넣을 수 있는 만큼 (${fmt(cap)}곡)`);

/** 곡 수를 적는 모달 */
const countModal = (max: number) => ({ title: "더 넣기", label: `넣을 곡 수 (1~${fmt(max)})` });

/** 가져오는 동안 */
const fetching = () => "⏳ 곡을 가져오는 중…";
const fetchingCount = (done: number, want: number) => `⏳ ${done}/${want}곡 가져오는 중…`;

// 거절
const REFUSAL = {
  "not-requester": () => noticeOf("warning", "permission", "목록을 넣은 사람만 더 넣을 수 있어요."),
  "not-requester-close": () => noticeOf("warning", "permission", "목록을 넣은 사람만 닫을 수 있어요."),
  expired: () => noticeOf("warning", "stale", "시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요."),
  full: () => noticeOf("warning", "state", "대기열이 가득 차 지금은 더 넣을 수 없어요."),
  "bad-count": () => noticeOf("warning", "input", "넣을 곡 수를 1 이상의 숫자로 적어 주세요."),
  "unknown-menu": () => noticeOf("warning", "stale", "알 수 없는 메뉴예요."),
} as const satisfies Record<string, () => Notice>;
type MoreRefusal = keyof typeof REFUSAL;
const refusal = (code: MoreRefusal) => REFUSAL[code]();

export { offered, added, finished, progressed, noRoom, menu, step, capLabel, countModal, fetching, fetchingCount, refusal };
export type { MoreRefusal };
