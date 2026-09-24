// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 대기열을 보여 주는 자리들이 같은 생김새를 쓰게 한다.
//
// `/queue`와 대기열 버튼은 거의 같은 임베드를 각자 만들고 있었다. 한쪽만 고치면 표시가 갈리므로
// 줄 만드는 일을 여기로 모은다. 점프 메뉴 설명도 같은 규칙(요청자 표기)을 따른다.

import format from "./format.ts";
const { formatDuration } = format;

// 자동재생이 미리 뽑아 둔 곡 표시. 장르별 이모지는 쓰지 않는다.
// 알려야 하는 것은 "자동으로 들어온 곡"이지 장르가 아니고, 장르마다 다르면 전달이 흐려진다.
const AUTOPLAY_MARK = "🎲";

// 임베드용. 멘션으로 적는다. 알림은 가지 않고, 이름 캐시가 없어도 항상 맞게 보인다.
function requesterLabel(track) {
  if (track?.autoplay) return AUTOPLAY_MARK;
  const id = track?.requestedBy?.id;
  return id ? `<@${id}>` : null;
}

// 셀렉트 메뉴용. 옵션 설명은 멘션을 렌더링하지 않아 <@id>가 그대로 보인다. 이름을 쓴다.
// 복원된 곡은 id만 남으므로(세션에는 id만 저장한다) 그때는 요청자를 적지 않는다.
function requesterName(track) {
  if (track?.autoplay) return AUTOPLAY_MARK;
  const who = track?.requestedBy;
  return who?.username || who?.displayName || who?.tag || null;
}

/** 대기열 한 줄: `` `3.` [제목](url) | 요청자 `` (줄바꿈 포함) */
function queueLine(track, number) {
  const head = `\`${number}.\` **[${track.title}](${track.pageUrl})**`;
  const who = requesterLabel(track);
  return `${who ? `${head} | ${who}` : head}\n`;
}

/**
 * 점프 메뉴 설명: `아티스트 | 길이 | 요청자`.
 * 디스코드 상한이 100자라 넘치면 아티스트부터 줄인다. 길이와 요청자는 짧고 정보가 분명하다.
 */
function jumpDescription(track) {
  const tail = [track?.duration ? formatDuration(track.duration) : null, requesterName(track)].filter(Boolean).join(" | ");
  const artist = track?.artist || "";
  if (!artist) return tail || undefined;

  const room = 100 - (tail ? tail.length + 3 : 0); // " | "
  const trimmed = artist.length > room ? `${artist.slice(0, Math.max(0, room - 1))}…` : artist;
  return tail ? `${trimmed} | ${tail}` : trimmed;
}

const exported = { queueLine, jumpDescription, requesterLabel, requesterName, AUTOPLAY_MARK };
export default exported;
export { exported as "module.exports" };
