// 직접 지정한 음원(pinned_sources). 운영자가 캐시 DB 에서 "이 요청은 이 음원으로 튼다"고 정한 것. 곡을 찾을 때 링크 데이터보다 먼저 본다.
// 메모리에 따로 올리지 않고 표를 바로 읽는다(키 하나 조회라 가볍고, 같은 값을 두 벌 두지 않는다). 오디오 캐시 초기화에서 따로 고른다(rules/audio-cache-parts 의 pins, 처음엔 꺼 둔다).

import { cacheDb } from "./cache-db.ts";
import * as audioCache from "./audio-cache.ts";
import * as trackLookup from "./track-lookup.ts";
import { DONE, GONE, changedTo, type Guarded } from "./guarded-write.ts";
import { canonicalUrl } from "../rules/canonical-url.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import type { AudioFoundBy } from "../rules/audio-found-by.ts";

/** 직접 지정한 음원 하나. requestKey 는 다듬은 요청 키(canonicalUrl) */
type Pin = { requestKey: string; audioUrl: string; pinnedAt: number };
type PinRow = { request_key: string; audio_url: string; pinned_at: number };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();
const pinOf = (row: PinRow | undefined): Pin | null => (row ? { requestKey: row.request_key, audioUrl: row.audio_url, pinnedAt: row.pinned_at } : null);

/** 이 요청의 직접 지정한 음원. 없으면 null. 사용자가 입력한 링크면 다듬어서 찾는다 */
function getPin(requestKey: string | null | undefined): Pin | null {
  if (!requestKey) return null;
  return pinOf(conn().prepare<[string], PinRow>("SELECT * FROM pinned_sources WHERE request_key = ?").get(canonicalUrl(requestKey)));
}

/** 직접 지정한다(있으면 바꾼다). 값 검사(rules/pin-source)는 부르는 쪽이 한다 */
function setPin(requestKey: string, audioUrl: string, pinnedAt = Date.now()) {
  conn().prepare("INSERT INTO pinned_sources (request_key, audio_url, pinned_at) VALUES (?, ?, ?) ON CONFLICT(request_key) DO UPDATE SET audio_url = excluded.audio_url, pinned_at = excluded.pinned_at").run(canonicalUrl(requestKey), audioUrl, pinnedAt);
}

const currentOf = (requestKey: string) => getPin(requestKey)?.audioUrl ?? null;

/**
 * 직접 지정한다(캐시 DB 화면). 지금 지정이 본 값(expect, 없었으면 null)일 때만 쓴다. 바뀌었으면 지금 지정(없으면 null)을 돌려준다.
 * 값 검사(rules/pin-source)는 부르는 쪽이 한다
 */
function repin(requestKey: string, audioUrl: string, expect: string | null, pinnedAt = Date.now()): Guarded<string | null> {
  const key = canonicalUrl(requestKey);
  const run = expect === null ? conn().prepare("INSERT INTO pinned_sources (request_key, audio_url, pinned_at) VALUES (?, ?, ?) ON CONFLICT(request_key) DO NOTHING").run(key, audioUrl, pinnedAt) : conn().prepare("UPDATE pinned_sources SET audio_url = ?, pinned_at = ? WHERE request_key = ? AND audio_url = ?").run(audioUrl, pinnedAt, key, expect);
  return run.changes ? DONE : changedTo(currentOf(key));
}

/** 지정을 해제한다(캐시 DB 화면). 지금 지정이 본 값일 때만 */
function unpin(requestKey: string, expect: string): Guarded<string> {
  if (conn().prepare("DELETE FROM pinned_sources WHERE request_key = ? AND audio_url = ?").run(canonicalUrl(requestKey), expect).changes) return DONE;
  const current = currentOf(requestKey);
  return current === null ? GONE : changedTo(current);
}

/** 요청 하나를 지운다(캐시 DB 화면): 링크 데이터 행과 직접 지정한 음원. 둘 다 본 값일 때만 한 번에 */
type RequestExpect = { ledgerAudioUrl: string | null; pinned: string | null };
function deleteRequest(requestKey: string, expect: RequestExpect): Guarded<RequestExpect> {
  return conn().transaction((): Guarded<RequestExpect> => {
    const current = { ledgerAudioUrl: trackLookup.getAudioUrl(requestKey), pinned: currentOf(requestKey) };
    if (current.ledgerAudioUrl === null && current.pinned === null) return GONE;
    if (current.ledgerAudioUrl !== expect.ledgerAudioUrl || current.pinned !== expect.pinned) return changedTo(current);
    trackLookup.removeResolution(requestKey);
    conn().prepare("DELETE FROM pinned_sources WHERE request_key = ?").run(canonicalUrl(requestKey));
    return DONE;
  })();
}

/** 직접 지정한 음원 전부(캐시 DB 읽기 · 내보내기) */
function allPins(): Pin[] {
  return conn()
    .prepare<[], PinRow>("SELECT * FROM pinned_sources")
    .all()
    .map((row) => pinOf(row)!);
}

/** 직접 지정한 음원을 붙일 곡. 여기서 읽고 쓰는 필드만(트랙 · 스포티파이 동등물 찾기의 곡 · 자동재생 곡) */
type PinTarget = { requestKey?: string | null; audioUrl?: string | null; audioFoundBy?: AudioFoundBy; isLive?: unknown; liveStatus?: unknown; duration?: unknown; durationSource?: unknown };

/**
 * 곡에 직접 지정한 음원을 붙인다: 음원 주소를 바꾸고 pinned 로 표시한다. 붙였으면 true. 이미 붙은 곡 · 지정이 없는 곡은 그대로(false).
 * 지정한 음원은 라이브가 아니므로(지정할 때 막는다) 라이브 표시를 끈다. 원래 곡의 길이는 다른 음원의 것이라 버리고,
 * 그 음원을 다운로드해 둔 파일이 있으면 그 길이를, 없으면 모름으로 둔다(틀 때 안다).
 * @param pin  이미 읽은 지정(자동재생은 바깥 경계로 받는다). 생략하면 곡의 요청 키로 읽는다
 */
function applyPin(track: PinTarget, pin: Pin | null = track.audioFoundBy === "pinned" ? null : getPin(track.requestKey)): boolean {
  if (track.audioFoundBy === "pinned" || !pin) return false;
  track.audioUrl = pin.audioUrl;
  track.audioFoundBy = "pinned";
  track.isLive = false;
  track.liveStatus = null;
  const key = audioKeyOf(pin.audioUrl);
  const cached = key ? audioCache.lookupByAudioKey(key) : null;
  const seconds = cached?.status === "cached" && cached.duration_sec ? cached.duration_sec : 0;
  track.duration = seconds;
  track.durationSource = seconds ? "measured" : "unknown";
  return true;
}

/** 직접 지정한 음원 수(저장 공간 카드 · 초기화 카드) */
function pinCount(): number {
  return conn().prepare("SELECT COUNT(*) FROM pinned_sources").pluck().get() as number;
}

export { getPin, setPin, repin, unpin, deleteRequest, allPins, pinCount, applyPin };
export type { Pin, PinTarget, RequestExpect };
