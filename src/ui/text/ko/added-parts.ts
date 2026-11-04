// 곡을 추가한 안내의 본문 문장. 디스코드 추가 안내(queue.added)와 대시보드 곡 추가 칸이 같이 쓴다.
// 브라우저(대시보드)도 쓴다. Node, discord.js 에 기대는 것이 없다(꾸밈은 부르는 쪽이 씌운다)

import { songTitle } from "./labels.ts";
import { josa } from "../../../rules/josa.ts";

/**
 * 추가한 곡. collection 은 여러 곡을 추가한 출처의 이름(labels.collection, 없으면 한 곡), total 은 출처 전체 곡 수(일부만 추가했을 때),
 * first 는 대기열 맨 앞에 넣었는지, position 은 넣은 첫 곡의 대기열 순번(1부터, 모르면 null)
 */
type AddedTracks = { tracks: Array<{ title?: string | null }>; collection: string | null; total: number | null; first: boolean; position?: number | null };

/** 추가 안내 본문을 곡 이름(한 곡일 때, 아니면 null)과 나머지 문장으로 나눈 것. 디스코드는 이름을 굵게, 대시보드는 이름만 줄여 보인다 */
function addedParts({ tracks, collection, total, first, position = null }: AddedTracks): { name: string | null; rest: string } {
  // 여러 곡은 첫 곡의 순번부터. 목록에서 한 곡만 넣었으면 그 자리
  const where = first ? "대기열 맨 앞에" : position ? `대기열 ${position}번째${tracks.length > 1 ? "부터" : "에"}` : "대기열에";
  // 목록의 일부만 넣었으면 전체 중 몇 곡인지. "N개 (전체 M곡)" 형식은 넣은 수인지 대기열 수인지 헷갈린다
  if (collection && total) return { name: null, rest: `${collection} ${total.toLocaleString("ko-KR")}곡 중 ${tracks.length}곡을 ${where} 넣었어요.` };
  if (collection) return { name: null, rest: `${collection}의 ${tracks.length}곡을 ${where} 넣었어요.` };
  const name = songTitle(tracks[0]?.title);
  return { name, rest: `${josa(name, "을")} ${where} 넣었어요.` };
}

export { addedParts };
export type { AddedTracks };
