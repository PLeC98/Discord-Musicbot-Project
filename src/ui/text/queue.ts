// 대기열에 담은 안내와 대기열 화면의 글자

import { escapeMd } from "../mentions.ts";

/**
 * 곡을 담은 안내. collection 은 여러 곡을 담은 출처의 이름(labels.collection, 없으면 한 곡),
 * total 은 출처 전체 곡 수(일부만 담았을 때), first 는 대기열 맨 앞에 넣었는지
 */
function added({ tracks, collection, total, first }: { tracks: Array<{ title?: string }>; collection: string | null; total: number | null; first: boolean }) {
  const where = first ? "대기열 맨 앞에" : "대기열에";
  const mark = first ? "⏫" : "✅";
  // 목록의 일부만 넣었으면 전체 중 몇 곡인지. "N개 (전체 M곡)"은 넣은 수인지 대기열 수인지 헷갈렸다
  if (collection && total) return `${mark} ${collection} 전체 ${total.toLocaleString("ko-KR")}곡 중 ${tracks.length}곡이 ${where} 추가되었습니다!`;
  if (collection) return `${mark} ${collection}의 ${tracks.length}개 노래가 ${where} 추가되었습니다!`;
  return `${mark} **${escapeMd(tracks[0]?.title || "알 수 없는 트랙")}**이(가) ${where} 추가되었습니다!`;
}

/** 담은 안내 밑의 경고 줄. skipped 출처가 받을 수 없어 뺀 곡 수, dropped 대기열이 차서 못 넣은 곡 수, queueLimited 자리가 모자라 목록을 덜 받음 */
function addedWarnings({ dropped, skipped, queueLimited, max }: { dropped: number; skipped: number; queueLimited: boolean; max: number }) {
  let text = "";
  if (skipped > 0) text += `\n⚠️ 받을 수 없는 ${skipped}곡(미리듣기 · 지역 제한 등)은 뺐습니다`;
  if (dropped > 0) text += `\n⚠️ 대기열이 가득 차 ${dropped}곡은 넣지 못했습니다 (최대 ${max}곡)`;
  else if (queueLimited) text += `\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다 (최대 ${max}곡)`;
  return text;
}

/** 대기열이 차서 한 곡도 못 넣었다 */
const full = (max: number) => `대기열이 가득 찼습니다 (최대 ${max}곡)`;

/** 대기열 화면. waiting 은 다음 곡 수, total 은 지금 곡까지 센 수 */
const view = ({ waiting, total, page, pages }: { waiting: number; total: number; page: number; pages: number }) => ({
  title: "📝 재생 대기열",
  header: `📋 다음 노래들 (${waiting}개)`,
  footer: `총 ${total}개의 노래${pages > 1 ? ` • ${page}/${pages} 페이지` : ""}`,
});
/** 대기열 화면에서 지금 곡의 머리 */
const currentHeader = () => "🎵 현재 재생 중";

export { added, addedWarnings, full, view, currentHeader };
