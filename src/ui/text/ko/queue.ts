// 대기열에 추가한 안내와 대기열 화면의 문구

import { addedParts, type AddedTracks } from "./added-parts.ts";
import { escapeMd } from "../../mentions.ts";
import { icon, type IconKey } from "../../icons.ts";

/** 곡을 추가한 안내 { icon, title, body }(icon 은 헤더 줄 아이콘의 키) */
function added(addition: AddedTracks): { icon: IconKey; title: string; body: string } {
  const head = { icon: addition.first ? "first_added" : "done", title: "곡을 추가했어요!" } as const;
  const { name, rest } = addedParts(addition);
  return { ...head, body: name === null ? rest : `**${escapeMd(name)}**${rest}` };
}

/** 일부만 추가했을 때(경고 줄이 있을 때) 추가 안내의 헤더 줄을 대신한다 */
const partlyAdded = (): { icon: IconKey; title: string } => ({ icon: "state", title: "일부 곡을 추가했어요!" });

/** 추가 안내 밑의 경고 줄들. skipped 출처가 받을 수 없어 뺀 곡 수, dropped 대기열이 차서 못 넣은 곡 수, queueLimited 자리가 모자라 목록을 덜 불러옴 */
function addedWarnings({ dropped, skipped, queueLimited, max }: { dropped: number; skipped: number; queueLimited: boolean; max: number }) {
  const lines: string[] = [];
  if (skipped > 0) lines.push(`재생할 수 없는 ${skipped}곡은 제외됐어요. (미리듣기, 지역 제한 등)`);
  if (dropped > 0) lines.push(`대기열이 가득 차서 ${dropped}곡은 넣지 못했어요. (최대 ${max}곡)`);
  else if (queueLimited) lines.push(`대기열이 가득 차서 목록의 일부만 넣었어요. (최대 ${max}곡)`);
  return lines;
}

/** 대기열 화면. count 는 다음 곡 수, 페이지가 둘 이상이면 몇 페이지인지 */
const view = ({ count, page, pages }: { count: number; page: number; pages: number }) => ({
  title: `${icon("queue")} 재생 대기열`,
  footer: `모두 ${count}곡${pages > 1 ? ` • ${page}/${pages} 페이지` : ""}`,
});

export { added, partlyAdded, addedWarnings, view };
