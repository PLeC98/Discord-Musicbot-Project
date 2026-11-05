// 대기열에 추가한 안내와 대기열 화면의 문구

import { addedParts, FULL_TITLE, shortfallParts, type AddedTracks, type Shortfall } from "./added-parts.ts";
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

/** 추가 안내 밑의 경고 줄들(대시보드 경고 알림과 같은 문장, added-parts) */
const addedWarnings = (shortfall: Shortfall) => {
  const { full, left } = shortfallParts(shortfall);
  return [left, full && `**${FULL_TITLE}** ${full}`].filter((line): line is string => Boolean(line));
};

/** 대기열 화면. count 는 다음 곡 수, 페이지가 둘 이상이면 몇 페이지인지 */
const view = ({ count, page, pages }: { count: number; page: number; pages: number }) => ({
  title: `${icon("queue")} 재생 대기열`,
  footer: `모두 ${count}곡${pages > 1 ? ` • ${page}/${pages} 페이지` : ""}`,
});

export { added, partlyAdded, addedWarnings, view };
