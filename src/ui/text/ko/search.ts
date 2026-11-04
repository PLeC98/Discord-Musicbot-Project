// 곡 검색(/search, /play, 전용 채널 입력)의 문구

import { clipText } from "../../../rules/clip-text.ts";
import { icon } from "../../icons.ts";
import { escapeMd } from "../../mentions.ts";

/** /search 결과 카드의 헤더 줄(아이콘은 그리는 쪽이 붙인다) */
const resultsTitle = (query: string) => `"${escapeMd(query)}" 검색 결과`;
/** 결과 한 줄: 번호와 제목 링크, 아랫줄 작은 글씨에 출처 아이콘과 `채널 | 길이`. 제목이 없으면 알 수 없는 곡, 채널이 없으면 뺀다. 제목 70자, 채널 40자(가수를 모두 이은 스포티파이 곡도 10줄이 글 표시 4000자 안에 들게) */
const resultLine = (rank: number, { title, link, source, artist, length }: { title: string | null; link: string; source: string; artist?: string | null; length: string }) => `**${rank}.** [${escapeMd(clipText(title || "알 수 없는 곡", 70))}](${link})\n-# ${source} ${[artist ? escapeMd(clipText(artist, 40)) : null, length].filter(Boolean).join(" | ")}`;
/** 유튜브가 연령 인증을 걸어 스포티파이 곡만 보일 때의 카드 푸터 */
const gatedFooter = () => "유튜브가 연령 인증을 요구하는 검색어예요";
/** 결과 카드 밖의 선택 메뉴 */
const pickPlaceholder = () => "여기를 눌러 추가할 곡을 골라 주세요!";
/** 메뉴 항목: `n. 제목`, 설명 `채널 | 길이`(100자) */
const pickOption = (rank: number, { title, artist, length }: { title: string | null; artist?: string | null; length: string }) => ({
  label: clipText(`${rank}. ${title || "알 수 없는 곡"}`, 100),
  description: clipText([artist, length].filter(Boolean).join(" | "), 100),
});
/** 길이를 모르는 곡 */
const unknownLength = () => "알 수 없음";

/** 선택한 곡을 넣는 동안. 제목을 모르면 곡이라고만 */
const addingTrack = (title: string | null) => (title ? `${icon("progress")} **${escapeMd(title)}** 추가하는 중...` : `${icon("progress")} 곡을 추가하는 중...`);

// 자동완성 선택지 이름은 꾸밈 없는 글자 100자까지다(앱 이모지, 마크다운이 먹지 않는다). 선택하면 입력란이 이 이름으로 바뀌어 다시 검색어가 될 수 있다
const CHOICE_MAX = 100;

/** 자동완성 맨 위 줄: 입력한 검색어로 결과 화면을 연다. 넘치면 검색어를 자른다 */
const resultsChoice = (query: string) => {
  const room = CHOICE_MAX - '🔍 "" 검색 결과 보기'.length;
  return `🔍 "${clipText(query, room)}" 검색 결과 보기`;
};
/** 자동완성 곡 후보: `제목 - 채널 (길이)`, 스포티파이 곡은 끝에 `(Spotify)`(이모지가 먹지 않아 출처를 글자로). 넘치면 뒤는 두고 앞을 자른다 */
const songChoice = ({ title, artist, length, spotify = false }: { title: string | null; artist?: string | null; length: string; spotify?: boolean }) => {
  const tail = ` (${length})${spotify ? " (Spotify)" : ""}`;
  return clipText(`${title || "알 수 없는 곡"}${artist ? ` - ${artist}` : ""}`, CHOICE_MAX - tail.length) + tail;
};

// 선택한 후보의 이름이 입력란에 들어간 뒤 고쳐져 다시 온 것. 맨 위 줄은 따옴표 안, 곡 후보는 끝의 길이를 뗀다
const RESULTS_ECHO = /^🔍 "([^"]*)"?/u;
const SONG_TAIL = / \((?:(?:\d+:)?\d{1,2}:\d{2}|🔴LIVE|예정된 라이브|알 수 없음)\)(?: \(Spotify\))?$/u;

/** 자동완성에 들어온 글자 → 찾을 검색어. 선택지 이름을 고쳐 온 것이면 그 안의 검색어만 */
const queryOfTyped = (typed: string) => {
  const echoed = RESULTS_ECHO.exec(typed);
  return (echoed ? echoed[1] : typed.replace(SONG_TAIL, "")).trim();
};

/** /play, 전용 채널 입력이 찾는 동안의 플레이스홀더. input 은 입력한 것(전용 채널은 앞부분만 자른 것) */
const searching = (input: string) => `${icon("progress")} **${input}** 검색 중...`;

export { resultsTitle, resultLine, gatedFooter, pickPlaceholder, pickOption, unknownLength, addingTrack, resultsChoice, songChoice, queryOfTyped, searching };
