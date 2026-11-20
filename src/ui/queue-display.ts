// 대기열 줄 만들기. /queue 화면(보기, 편집), 대기열 버튼, 곡을 고르는 메뉴(재생 패널의 곡으로 건너뛰기, /queue 편집)가 같은 규칙(요청자 표기)을 쓰게 한 곳에 둔다.

import { clipWidth } from "../rules/clip-text.ts";
import type { MenuEntry, Part } from "./menu-fit.ts";
import { formatDuration, liveMarkOf } from "./format.ts";
import { songTitle } from "./text/ko/labels.ts";
import * as queueText from "./text/ko/queue.ts";
import { escapeMd, linkLabel } from "./mentions.ts";
import { ICONS, icon } from "./icons.ts";
import { jumpValue } from "./custom-ids.ts";
import type { QueuedTrack } from "../player/track.ts";

// 요청자 표기에서 읽는 필드
type Requested = Pick<QueuedTrack, "autoplay" | "requestedBy"> | null | undefined;

// 화면 글에 적는 요청자. 멘션으로 적는다(알림은 가지 않고, 이름 캐시가 없어도 항상 맞게 보인다).
// 자동재생 곡은 장르 이모지가 아니라 자동재생 아이콘과 이름이다(알릴 것은 장르가 아니라 자동으로 들어온 곡이라는 것)
function requesterLabel(track: Requested) {
  if (track?.autoplay) return `${icon("autoplay")} ${queueText.autoplayBy}`;
  const id = track?.requestedBy?.id;
  return id ? `<@${id}>` : null;
}

// 셀렉트 메뉴용. 옵션 설명은 멘션, 앱 이모지를 렌더링하지 않아 그대로 글자로 보인다. 이름과 유니코드를 쓴다.
// 복원된 곡은 id만 남으므로(세션에는 id만 저장한다) 그때는 요청자를 적지 않는다.
function requesterName(track: Requested) {
  if (track?.autoplay) return ICONS.autoplay.unicode;
  const who = track?.requestedBy;
  return who?.username || who?.displayName || who?.tag || null;
}

// 목록에 적는 곡
type Listed = Pick<QueuedTrack, "title" | "pageUrl" | "autoplay" | "requestedBy" | "artist" | "duration" | "isLive" | "liveStatus">;
type Length = Partial<Pick<QueuedTrack, "duration" | "isLive" | "liveStatus">> | null | undefined;

// 한 줄에 적는 제목, 아티스트의 상한. 넘치면 잘라 "..."을 붙인다(끝 표시까지 이 길이)
const TITLE_MAX = 60;
const ARTIST_MAX = 40;
const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** 길이 표기. 라이브는 진행 막대와 같은 표기(시작 전이면 예정된 라이브), 모르면 null */
const lengthOf = (track: Length) => (track?.isLive ? liveMarkOf(track) : formatDuration(track?.duration, "") || null);

/**
 * 대기열 한 곡의 두 줄: `` `3` **[제목](url)** · 길이 `` 아래 작은 글씨로 `아티스트 · 요청자 · 시작까지`. 아래 줄은 적을 것이 없으면 없다.
 * link가 거짓이면 제목만(라벨 밖이라 이스케이프한다). startsIn: 시작까지의 초(rules/queue-timing), 모르면 null
 */
function entryLine(track: Listed, number: number, { link = true, startsIn = null }: { link?: boolean; startsIn?: number | null } = {}) {
  const title = shorten(songTitle(track.title), TITLE_MAX);
  const name = link && track.pageUrl ? `[${linkLabel(title)}](${track.pageUrl})` : escapeMd(title);
  const length = lengthOf(track);
  const head = `\`${number}\` **${name}**${length ? ` · ${length}` : ""}`;
  const below = [track.artist ? escapeMd(shorten(track.artist, ARTIST_MAX)) : null, requesterLabel(track), startsIn === null ? null : queueText.startsIn(startsIn)].filter(Boolean);
  return below.length ? `${head}\n-# ${below.join(" · ")}` : head;
}

/**
 * 대기열 한 페이지의 줄들. 넘치면(max) 주소가 가장 긴 곡부터 링크를 떼 제목만 남긴다(서명된 직접 링크, 한글이 인코딩된 출처 주소는
 * 수백 자다). 링크를 다 떼면 한 곡에 200자 안쪽이라 한 페이지가 들어간다. 그래도 넘치면 자른다.
 * first: 첫 곡의 번호, startsIn: 곡마다 시작까지의 초
 */
function entryLines({ tracks, first = 1, startsIn = [], max }: { tracks: Listed[]; first?: number; startsIn?: Array<number | null>; max: number }) {
  const linked = new Set<number>(tracks.map((_, i) => i));
  const urlOf = (i: number) => tracks[i]?.pageUrl || "";
  const render = () => tracks.map((track, i) => entryLine(track, first + i, { link: linked.has(i), startsIn: startsIn[i] ?? null })).join("\n");
  let text = render();
  while (text.length > max && linked.size) {
    const longest = [...linked].reduce((a, b) => (urlOf(b).length > urlOf(a).length ? b : a));
    linked.delete(longest);
    text = render();
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 곡을 고르는 메뉴의 항목 이름(`번호. 제목`)의 화면 폭. 이 폭을 넘는 부분은 어느 기기에서도 메뉴에서 잘려 보이지 않는다 */
const LABEL_WIDTH = 66;

/** 메뉴 설명의 칸 구분자 */
const JUMP_SEPARATOR = " | ";
const EDIT_SEPARATOR = " · ";

/** 점프 메뉴 설명의 칸: `아티스트 | 길이 | 요청자`. 라이브는 길이 자리에 진행 막대와 같은 표기(시작 전이면 예정된 라이브). 길이는 줄이지 않는다 */
function jumpParts(track: (Requested & Length & Partial<Pick<QueuedTrack, "artist">>) | null | undefined): Part[] {
  return [
    { text: track?.artist ?? "", cut: true },
    { text: lengthOf(track) ?? "", cut: false },
    { text: requesterName(track) ?? "", cut: true },
  ];
}

/** /queue 편집 메뉴 설명의 칸: `아티스트 · 길이` */
function editParts(track: (Length & Partial<Pick<QueuedTrack, "artist">>) | null | undefined): Part[] {
  return [
    { text: track?.artist ?? "", cut: true },
    { text: lengthOf(track) ?? "", cut: false },
  ];
}

/**
 * 곡을 고르는 메뉴의 항목(ui/menu-fit이 크기에 맞춰 메뉴로 만든다). 이름은 `번호. 제목`을 화면 폭(LABEL_WIDTH)으로 자른 것, 값은 대기열 ID(jumpValue)라
 * 메뉴를 그린 뒤 대기열이 바뀌어도 고른 곡을 가리킨다. ID가 없거나 겹치는 곡은 뺀다(값이 겹친 메뉴는 디스코드가 메시지째 거절한다).
 * first: 첫 곡의 번호, parts: 설명의 칸, picked: 골라 둔 곡의 대기열 ID, only: 넣을 곡(거짓인 곡은 빼고, 번호는 대기열 자리 그대로)
 */
function menuEntries<T extends Pick<QueuedTrack, "title" | "entry">>(tracks: readonly T[], { first = 1, parts, picked = null, only = () => true }: { first?: number; parts: (track: T) => Part[]; picked?: number | null; only?: (track: T) => boolean }): MenuEntry[] {
  const seen = new Set<number>();
  return tracks.flatMap((track, i) => {
    if (track.entry === undefined || seen.has(track.entry) || !only(track)) return [];
    seen.add(track.entry);
    return [{ label: clipWidth(`${first + i}. ${songTitle(track.title)}`, LABEL_WIDTH), value: jumpValue(track.entry), parts: parts(track), picked: track.entry === picked }];
  });
}

export { LABEL_WIDTH, JUMP_SEPARATOR, EDIT_SEPARATOR, entryLine, entryLines, jumpParts, editParts, menuEntries };
export type { Listed };
