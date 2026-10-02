// 대기열에 담은 안내와 대기열 화면의 글자

import { escapeMd } from "../../mentions.ts";
import { josa } from "../../../rules/josa.ts";

/**
 * 곡을 담은 안내 { title, body }. collection 은 여러 곡을 담은 출처의 이름(labels.collection, 없으면 한 곡),
 * total 은 출처 전체 곡 수(일부만 담았을 때), first 는 대기열 맨 앞에 넣었는지
 */
function added({ tracks, collection, total, first }: { tracks: Array<{ title?: string }>; collection: string | null; total: number | null; first: boolean }) {
  const title = first ? "⏫ 곡을 추가했어요!" : "✅ 곡을 추가했어요!";
  const where = first ? "대기열 맨 앞에" : "대기열에";
  // 목록의 일부만 넣었으면 전체 중 몇 곡인지. "N개 (전체 M곡)"은 넣은 수인지 대기열 수인지 헷갈렸다
  if (collection && total) return { title, body: `${collection} ${total.toLocaleString("ko-KR")}곡 중 ${tracks.length}곡을 ${where} 넣었어요.` };
  if (collection) return { title, body: `${collection}의 ${tracks.length}곡을 ${where} 넣었어요.` };
  const name = tracks[0]?.title || "알 수 없는 트랙";
  return { title, body: `**${escapeMd(name)}**${josa(name, "을")} ${where} 넣었어요.` };
}

/** 일부만 담았을 때(경고 줄이 있을 때) 담은 안내의 머리 줄을 갈음한다 */
const partlyAdded = () => "⚠️ 일부 곡을 추가했어요!";

/** 담은 안내 밑의 경고 줄들. skipped 출처가 받을 수 없어 뺀 곡 수, dropped 대기열이 차서 못 넣은 곡 수, queueLimited 자리가 모자라 목록을 덜 받음 */
function addedWarnings({ dropped, skipped, queueLimited, max }: { dropped: number; skipped: number; queueLimited: boolean; max: number }) {
  const lines: string[] = [];
  if (skipped > 0) lines.push(`받을 수 없는 ${skipped}곡은 제외됐어요. (미리듣기 · 지역 제한 등)`);
  if (dropped > 0) lines.push(`대기열이 가득 차서 ${dropped}곡은 넣지 못했어요. (최대 ${max}곡)`);
  else if (queueLimited) lines.push(`대기열이 가득 차서 목록의 일부만 넣었어요. (최대 ${max}곡)`);
  return lines;
}

/** 대기열 화면. count 는 다음 곡 수, 쪽이 둘 이상이면 몇 쪽인지 */
const view = ({ count, page, pages }: { count: number; page: number; pages: number }) => ({
  title: "📝 재생 대기열",
  footer: `모두 ${count}곡${pages > 1 ? ` • ${page}/${pages}쪽` : ""}`,
});

export { added, partlyAdded, addedWarnings, view };
