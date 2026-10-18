// 직접 지정한 음원(pinned_sources). 운영자가 캐시 DB 에서 "이 요청은 이 음원으로 튼다"고 정한 것. 곡을 찾을 때 링크 데이터보다 먼저 본다.
// 메모리에 따로 올리지 않고 표를 바로 읽는다(키 하나 조회라 가볍고, 같은 값을 두 벌 두지 않는다). 캐시 초기화가 건너뛴다(cache-db 의 KEPT_ON_RESET).

import { cacheDb } from "./cache-db.ts";
import { canonicalUrl } from "../rules/canonical-url.ts";

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

/** 지정을 해제한다. 해제했으면 true */
function removePin(requestKey: string): boolean {
  return conn().prepare("DELETE FROM pinned_sources WHERE request_key = ?").run(canonicalUrl(requestKey)).changes > 0;
}

/** 직접 지정한 음원 전부(캐시 DB 읽기 · 내보내기) */
function allPins(): Pin[] {
  return conn()
    .prepare<[], PinRow>("SELECT * FROM pinned_sources")
    .all()
    .map((row) => pinOf(row)!);
}

/** 직접 지정한 음원 수(저장 공간 카드 · 초기화 카드) */
function pinCount(): number {
  return conn().prepare("SELECT COUNT(*) FROM pinned_sources").pluck().get() as number;
}

export { getPin, setPin, removePin, allPins, pinCount };
export type { Pin };
