// 곡 검색(/search, /play, 전용 채널 입력)의 문구

import { clipText } from "../../../rules/clip-text.ts";
import { icon } from "../../icons.ts";
import { escapeMd } from "../../mentions.ts";

/** /search 결과 화면. count 는 보여 준 결과 수 */
const results = (query: string, count: number) => ({ title: `${icon("search")} "${query}" 검색 결과`, description: "번호 버튼을 눌러 곡을 선택해 주세요.", footer: `결과 ${count}개`, cancel: "취소" });
/** 결과 필드 하나. 제목, 채널이 없으면 모른다고 적는다. length 는 곡 길이를 적은 것 */
const result = (rank: number, { title, uploader, length }: { title?: string | null; uploader?: string | null; length: string }) => ({ name: `${rank}. ${title || "알 수 없는 제목"}`, value: `${icon("person")} ${uploader || "알 수 없는 채널"} • ${icon("time")} ${length}` });
/** 길이를 모르는 결과 */
const unknownLength = () => "알 수 없음";
/** 선택한 곡을 넣는 동안 */
const adding = () => ({ title: `${icon("progress")} 넣는 중...`, description: "선택한 곡을 추가하고 있어요..." });

/** 고른 곡을 넣는 동안. 제목을 모르면 곡이라고만 */
const addingTrack = (title: string | null) => (title ? `${icon("progress")} **${escapeMd(title)}** 추가하는 중...` : `${icon("progress")} 곡을 추가하는 중...`);

// 자동완성 선택지 이름은 꾸밈 없는 글자 100자까지다(앱 이모지, 마크다운이 먹지 않는다). 고르면 입력 칸이 이 이름으로 바뀌어 다시 검색어가 될 수 있다
const CHOICE_MAX = 100;

/** 자동완성 맨 위 줄: 입력한 검색어로 결과 화면을 연다. 넘치면 검색어를 자른다 */
const resultsChoice = (query: string) => {
  const room = CHOICE_MAX - '🔍 "" 검색 결과 보기'.length;
  return `🔍 "${clipText(query, room)}" 검색 결과 보기`;
};
/** 자동완성 곡 후보: `제목 - 채널 (길이)`. 넘치면 길이는 두고 앞을 자른다 */
const songChoice = ({ title, artist, length }: { title: string | null; artist?: string | null; length: string }) => {
  const tail = ` (${length})`;
  return clipText(`${title || "알 수 없는 곡"}${artist ? ` - ${artist}` : ""}`, CHOICE_MAX - tail.length) + tail;
};

/** /play, 전용 채널 입력이 찾는 동안의 플레이스홀더. input 은 입력한 것(전용 채널은 앞부분만 자른 것) */
const searching = (input: string) => `${icon("progress")} **${input}** 검색 중...`;

export { results, result, unknownLength, adding, addingTrack, resultsChoice, songChoice, searching };
