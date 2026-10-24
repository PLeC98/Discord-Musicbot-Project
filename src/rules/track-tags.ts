// 판정: 음원 파일의 태그(제목 · 가수 · 앨범)를 곡 정보로 쓰나, 쓰면 무엇이 바뀌나. 보는 것은 곡과 태그뿐이다.
// 쓰는 곡은 요청한 링크가 곧 음원인 직접 링크 곡이다. 직접 지정한 음원 · 링크 데이터로 이은 음원은 곡 정보가 요청의 것이라 쓰지 않는다.
// 제목은 태그에 있으면 바꾸고(파일 이름보다 태그가 곡 이름이다), 가수 · 앨범은 비었을 때만 채운다

import { audioKeyOf } from "./audio-key-of.ts";
import { inputKind } from "./input-kind.ts";
import type { AudioFoundBy } from "./audio-found-by.ts";

type TagInfo = { title: string | null; artist: string | null; album: string | null };
type Tagged = { title: string | null; artist?: string; album?: string | null; requestKey: string; audioUrl?: string; audioFoundBy?: AudioFoundBy };

/** 이 곡에 태그 곡 정보를 쓰나 */
function takesTags(track: Tagged): boolean {
  if (track.audioFoundBy === "pinned" || inputKind(track.requestKey) !== "direct") return false;
  const key = audioKeyOf(track.audioUrl);
  return key !== null && key === audioKeyOf(track.requestKey);
}

/** 태그로 바뀌는 필드(바뀌는 것만). 쓰지 않는 곡이면 빈 것 */
function tagPatch(track: Tagged, tags: TagInfo): Partial<Pick<Tagged, "title" | "artist" | "album">> {
  if (!takesTags(track)) return {};
  const patch: Partial<Pick<Tagged, "title" | "artist" | "album">> = {};
  if (tags.title && tags.title !== track.title) patch.title = tags.title;
  if (tags.artist && !track.artist) patch.artist = tags.artist;
  if (tags.album && !track.album) patch.album = tags.album;
  return patch;
}

export { takesTags, tagPatch };
export type { TagInfo };
