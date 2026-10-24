// 판정: 캐시 DB 에서 지정할 음원 · 새 행의 원래 링크가 쓸 수 있는 주소인가, 저장할 형식은. 보는 것은 주소 문자열뿐이다(통신하지 않는다. 재생되는지는 재생 확인).
// 지정할 음원: 다운로드할 수 있는 곡 하나(유튜브 영상 · 사운드클라우드 곡 · 직접 링크 오디오). 스포티파이는 다운로드할 수 없고, 사운드클라우드 짧은 링크는 키가 풀린 주소와 달라진다.
// 원래 링크: 링크 데이터 · 곡 찾기가 쓰는 곡 하나의 링크. 재생목록 · 앨범 · 세트 · 짧은 링크 · 검색어는 지정한 음원이 무엇을 가리키는지 정해지지 않는다(재생목록 주소는 영상 하나로 줄어든다).

import type { Code } from "./problems.ts";
import { audioKeyOf } from "./audio-key-of.ts";
import { canonicalUrl } from "./canonical-url.ts";
import { inputKind, type InputKind } from "./input-kind.ts";
import { extractVideoId, isYouTubePlaylist, parseSoundCloudURL, parseSpotifyURL, youtubeWatchUrl } from "./links.ts";

type Refused = { ok: false; code: Code };
type PinAudio = { ok: true; canonical: string; kind: InputKind; audioKey: string } | Refused;
type PinRequest = { ok: true; canonical: string; platform: InputKind } | Refused;

const refused = (code: Code): Refused => ({ ok: false, code });

// 사운드클라우드는 곡 하나만. 짧은 링크는 풀어야 곡인지 알고 키도 달라진다
function soundCloudTrack(url: string): Code | null {
  const shape = parseSoundCloudURL(url);
  if (shape === "track") return null;
  return shape === "short" ? "sc-unsupported" : "not-single-track";
}

/** 지정할 음원. 유튜브는 영상 하나의 보는 주소로(재생목록 파라미터는 버린다), 그 밖은 canonicalUrl */
function checkPinAudio(input: string): PinAudio {
  const url = input.trim();
  const kind = inputKind(url);
  if (kind === "spotify") return refused("not-audio-source");
  if (kind === "search" || kind === "unknown") return refused("unsupported-link");
  if (kind === "soundcloud") {
    const problem = soundCloudTrack(url);
    if (problem) return refused(problem);
  }
  const videoId = kind === "youtube" ? extractVideoId(url) : null;
  if (kind === "youtube" && !videoId) return refused("not-single-track");
  const canonical = videoId ? youtubeWatchUrl(videoId) : canonicalUrl(url);
  const audioKey = audioKeyOf(canonical);
  return audioKey ? { ok: true, canonical, kind, audioKey } : refused("unsupported-link");
}

// 곡 하나가 아니면 그 문제 코드
function notSingle(kind: InputKind, url: string): Code | null {
  if (kind === "search") return "not-single-track";
  if (kind === "unknown") return "unsupported-link";
  if (kind === "youtube") return isYouTubePlaylist(url) || !extractVideoId(url) ? "not-single-track" : null;
  if (kind === "spotify") return parseSpotifyURL(url).type === "track" ? null : "not-single-track";
  if (kind === "soundcloud") return soundCloudTrack(url);
  return null;
}

/** 새 행의 원래 링크. 링크 데이터의 키와 같은 형식(canonicalUrl)으로 */
function checkPinRequest(input: string): PinRequest {
  const url = input.trim();
  const platform = inputKind(url);
  const problem = notSingle(platform, url);
  return problem ? refused(problem) : { ok: true, canonical: canonicalUrl(url), platform };
}

export { checkPinAudio, checkPinRequest };
export type { PinAudio, PinRequest };
