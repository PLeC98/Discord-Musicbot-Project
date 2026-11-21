// 재생목록 "더 넣기" 메뉴, 모달, 결과의 문구. 수는 여기서 자릿점을 찍는다.
// 결과의 글(result)은 대시보드도 그리므로 아이콘 없이 두고, 디스코드 메뉴는 resultMark로 아이콘을 앞에 붙인다

import { josa } from "../../../src/rules/josa.ts";
import { icon } from "../../../src/ui/icons.ts";
import * as labels from "./labels.ts";
import type { MoreOutcome } from "../../../src/rules/more-choices.ts";

const fmt = (n: number | null) => Number(n).toLocaleString("ko-KR");

/** 처음 표시하는 메뉴의 헤더. collection은 출처의 이름(labels.collection) */
const offered = (collection: string, total: number, offset: number) => `${icon("playlist_add")} ${collection}${josa(collection, "은")} 모두 ${fmt(total)}곡이에요. 앞 ${fmt(offset)}곡까지 넣었어요.`;

/** 디스코드 메뉴에서 이어 넣은 결과의 글 앞에 */
const resultMark = (text: string) => `${icon("ok")} ${text}`;

/** 이어 넣은 결과의 헤더 */
function added({ collection, added, skipped, dropped }: { collection: string; added: number; skipped?: number; dropped?: number }) {
  let head = `${collection}에서 ${fmt(added)}곡을 더 넣었어요.`;
  if (skipped && skipped > 0) head += ` 재생할 수 없는 ${fmt(skipped)}곡(삭제, 비공개, 미리듣기 전용, 지역 제한 등)은 제외했어요.`;
  if (dropped && dropped > 0) head += ` 대기열이 가득 차 ${fmt(dropped)}곡은 빠졌어요.`;
  return head;
}
/** 목록을 끝까지 넣었다 */
const finished = (head: string) => `${head} 목록을 끝까지 넣었어요.`;
/** 이어 넣을 것이 남았다. at은 넣은 데까지의 위치 */
const progressed = (head: string, total: number | null, at: number) => `${head} (${fmt(total)}곡 중 ${fmt(at)}곡까지)`;
/** 이어 넣은 결과의 글. 끝까지 넣었으면 그렇다고, 더 넣을 것이 남았으면 어디까지 넣었는지를 붙인다 */
function result({ collection, added: count, skipped, dropped, total, remaining, nextOffset }: MoreOutcome) {
  const head = added({ collection: labels.collection(collection), added: count, skipped, dropped });
  if (nextOffset === null) return remaining > 0 ? head : finished(head);
  return progressed(head, total, nextOffset);
}
/** 대기열이 가득 차 더 넣을 수 없다 */
const roomFull = () => "대기열이 가득 차 지금은 더 넣을 수 없어요.";
/** 자리가 없어 메뉴를 표시하지 않는다 */
const noRoom = (head: string) => `${head}\n${roomFull()}`;

/** 메뉴. remaining은 남은 곡 수 */
const menu = (remaining: number) => ({ placeholder: `더 넣기 (남은 ${fmt(remaining)}곡)`, custom: "직접 입력…", stop: "그만 넣기" });
/** n 곡 더 */
const step = (n: number) => `${fmt(n)}곡 더`;
/** 가장 큰 선택지. all은 남은 곡을 다 넣는지, perClick은 출처의 한 번 상한에 걸렸는지 */
const capLabel = (cap: number, { all, perClick }: { all: boolean; perClick: boolean }) => (all ? `남은 곡 전부 (${fmt(cap)}곡)` : perClick ? step(cap) : `넣을 수 있는 만큼 (${fmt(cap)}곡)`);

/** 곡 수를 입력하는 모달 */
const countModal = (max: number) => ({ title: "더 넣기", label: `넣을 곡 수 (1~${fmt(max)})` });

/** 가져오는 동안 */
const fetching = () => `${icon("progress")} 곡을 가져오는 중…`;
const fetchingCount = (done: number, want: number) => `${icon("progress")} ${done}/${want}곡 가져오는 중…`;

export { offered, resultMark, added, finished, progressed, result, roomFull, noRoom, menu, step, capLabel, countModal, fetching, fetchingCount };
