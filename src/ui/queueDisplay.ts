// 대기열을 보여 주는 자리들이 같은 생김새를 쓰게 한다.
//
// `/queue`와 대기열 버튼은 거의 같은 임베드를 각자 만들고 있었다. 한쪽만 고치면 표시가 갈리므로
// 줄 만드는 일을 여기로 모은다. 점프 메뉴 설명도 같은 규칙(요청자 표기)을 따른다.

import { formatDuration } from "./format.ts";
import type { QueuedTrack } from "../player/track.ts";

// 요청자 표기에서 읽는 칸
type Requested = Pick<QueuedTrack, "autoplay" | "requestedBy"> | null | undefined;

// 자동재생이 미리 뽑아 둔 곡 표시. 장르별 이모지는 쓰지 않는다.
// 알려야 하는 것은 "자동으로 들어온 곡"이지 장르가 아니고, 장르마다 다르면 전달이 흐려진다.
const AUTOPLAY_MARK = "🎲";

// 임베드용. 멘션으로 적는다. 알림은 가지 않고, 이름 캐시가 없어도 항상 맞게 보인다.
function requesterLabel(track: Requested) {
  if (track?.autoplay) return AUTOPLAY_MARK;
  const id = track?.requestedBy?.id;
  return id ? `<@${id}>` : null;
}

// 셀렉트 메뉴용. 옵션 설명은 멘션을 렌더링하지 않아 <@id>가 그대로 보인다. 이름을 쓴다.
// 복원된 곡은 id만 남으므로(세션에는 id만 저장한다) 그때는 요청자를 적지 않는다.
function requesterName(track: Requested) {
  if (track?.autoplay) return AUTOPLAY_MARK;
  const who = track?.requestedBy;
  return who?.username || who?.displayName || who?.tag || null;
}

// 목록에 적는 곡
type Listed = Pick<QueuedTrack, "title" | "pageUrl" | "autoplay" | "requestedBy">;

// 한 줄에 적는 제목의 상한. 넘치면 잘라 "..."을 붙인다(끝 표시까지 이 길이)
const TITLE_MAX = 60;
const shorten = (title: string) => (title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 3)}...` : title);

/** 대기열 한 줄: `` `3.` [제목](url) | 요청자 `` (줄바꿈 포함). link 가 거짓이면 제목만 */
function queueLine(track: Listed, number: number, { link = true }: { link?: boolean } = {}) {
  const title = shorten(track.title || "");
  const head = `\`${number}.\` **${link && track.pageUrl ? `[${title}](${track.pageUrl})` : title}**`;
  const who = requesterLabel(track);
  return `${who ? `${head} | ${who}` : head}\n`;
}

/**
 * 점프 메뉴 설명: `아티스트 | 길이 | 요청자`.
 * 디스코드 상한이 100자라 넘치면 아티스트부터 줄인다. 길이와 요청자는 짧고 정보가 분명하다.
 */
function jumpDescription(track: (Requested & Partial<Pick<QueuedTrack, "duration" | "artist">>) | null | undefined) {
  const tail = [track?.duration ? formatDuration(track.duration) : null, requesterName(track)].filter(Boolean).join(" | ");
  const artist = track?.artist || "";
  if (!artist) return tail || undefined;

  const room = 100 - (tail ? tail.length + 3 : 0); // " | "
  const trimmed = artist.length > room ? `${artist.slice(0, Math.max(0, room - 1))}…` : artist;
  return tail ? `${trimmed} | ${tail}` : trimmed;
}

// 임베드 본문(description)의 상한
const DESCRIPTION_MAX = 4096;

/**
 * 대기열 임베드의 본문. 칸(field)은 1024자라 나눠 실어야 하고, 나누면 칸마다 이름 줄이 생겨 빈 여백이 끼어 본문(4096자)에 싣는다.
 * 제목은 60자에서 줄이고, 그래도 넘치면 주소가 가장 긴 곡부터 링크를 떼 제목만 남긴다(서명된 직접 링크 · 한글이 인코딩된 출처 주소는
 * 수백 자다). 링크를 다 떼면 줄마다 150자 안쪽이라 한 쪽이 반드시 들어간다.
 * first: 첫 곡의 번호, more: 목록 뒤에 붙일 한 줄
 */
function queueDescription({ current, header, tracks, first = 1, more = null }: { current?: Listed | null; header: string; tracks: Listed[]; first?: number; more?: string | null }) {
  // 링크를 다는 곡. 현재 곡은 -1
  const linked = new Set<number>(tracks.map((_, i) => i));
  if (current) linked.add(-1);
  const urlOf = (i: number) => (i < 0 ? current?.pageUrl : tracks[i]?.pageUrl) || "";
  const render = () => {
    const parts: string[] = [];
    if (current) {
      const title = shorten(current.title || "");
      parts.push(`**🎵 현재 재생 중**\n**${linked.has(-1) && current.pageUrl ? `[${title}](${current.pageUrl})` : title}**`);
    }
    if (tracks.length) parts.push(`**${header}**\n${tracks.map((track, i) => queueLine(track, first + i, { link: linked.has(i) })).join("")}${more ?? ""}`);
    return parts.join("\n\n");
  };
  let text = render();
  while (text.length > DESCRIPTION_MAX && linked.size) {
    const longest = [...linked].reduce((a, b) => (urlOf(b).length > urlOf(a).length ? b : a));
    linked.delete(longest);
    text = render();
  }
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text;
}

export { queueLine, queueDescription, jumpDescription, requesterLabel, requesterName, AUTOPLAY_MARK };
