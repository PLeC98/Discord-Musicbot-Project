// 대기열에 추가한 안내와 대기열 화면의 문구

import * as parts from "./added-parts.ts";
import type { AddedTracks, Shortfall } from "./added-parts.ts";
import { escapeMd } from "../../mentions.ts";
import { icon, type IconKey } from "../../icons.ts";
import { span } from "./labels.ts";

/** 곡을 추가한 안내 { icon, title, body }(icon은 헤더 줄 아이콘의 키) */
function added(addition: AddedTracks): { icon: IconKey; title: string; body: string } {
  const head = { icon: addition.first ? "first_added" : "done", title: "곡을 추가했어요!" } as const;
  const { name, rest } = parts.addedParts(addition);
  return { ...head, body: name === null ? rest : `**${escapeMd(name)}**${rest}` };
}

/** 일부만 추가했을 때(경고 줄이 있을 때) 추가 안내의 헤더 줄을 대신한다 */
const partlyAdded = (): { icon: IconKey; title: string } => ({ icon: "state", title: "일부 곡을 추가했어요!" });

/** 추가 안내 밑의 경고 줄들(대시보드 경고 알림과 같은 문장, added-parts) */
const addedWarnings = (shortfall: Shortfall) => {
  const { full, left } = parts.shortfallParts(shortfall);
  return [left, full && `**${parts.FULL_TITLE}** ${full}`].filter((line): line is string => Boolean(line));
};

/** 대기열 화면(/queue)의 제목: 보기, 편집 */
const title = () => `${icon("queue")} 재생 대기열`;
const editTitle = () => `${icon("edit")} 대기열 편집`;

/** 요약 줄: 곡 수, 아는 길이의 합(초, 0이면 뺀다), 다 끝나는 시각(초, 디스코드 타임스탬프. 모르면 뺀다) */
const summary = ({ count, totalSec, endsAt }: { count: number; totalSec: number; endsAt: number | null }) => [`총 ${count}곡`, totalSec > 0 ? span(totalSec) : null, endsAt === null ? null : `<t:${endsAt}:t>쯤 재생 종료`].filter(Boolean).join(" · ");

/** 곡이 시작하기까지(초). 1분 안이면 곧, 아니면 분 단위로 반올림 */
const startsIn = (sec: number) => (sec < 60 ? "곧 재생" : `약 ${span(Math.round(sec / 60) * 60)} 뒤`);

/** 자동재생 곡의 요청자 자리(자동재생 아이콘 뒤) */
const autoplayBy = "자동재생";

/** 썸네일 모자이크의 대체 글 */
const mosaicAlt = "대기열 곡들의 썸네일";

/** 넘기기 줄의 페이지 버튼, 편집과 완료 버튼 */
const pageOf = (page: number, pages: number) => `${page}/${pages}`;
const edit = "편집";
const done = "완료";

/** 편집 화면: 곡 고르기 메뉴, 고른 곡의 버튼 */
const pickPlaceholder = "편집할 곡을 골라 주세요";
const actions = { play: "지금 재생", next: "다음에 재생", up: "위로", down: "아래로", remove: "삭제" } as const;

/** 페이지 버튼이 여는 모달 */
const pageModal = (pages: number) => ({ title: "페이지 이동", label: "페이지 번호", placeholder: `1~${pages}` });

export { added, partlyAdded, addedWarnings, title, editTitle, summary, startsIn, autoplayBy, mosaicAlt, pageOf, edit, done, pickPlaceholder, actions, pageModal };
