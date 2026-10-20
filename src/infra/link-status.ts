// 외부 서비스마다 봇이 실제로 부른 결과(성공 · 실패 · 걸린 시간). 봇 상태 탭의 "연결"이 이것으로 매긴다(상태를 보려고 따로 부르지 않는다).
// HTTP 는 infra/http 가 남기고, HTTP 가 아닌 것(yt-dlp 로 부르는 SoundCloud)은 부른 쪽이 record 로 남긴다

/** 부르는 외부 서비스. anilist · github · modelsdev · discord 는 화면에 행이 없다(다른 일의 일부: 커버 이미지 · 업데이트 확인 · AI 가격표 다운로드 · 앱 이모지 그림 견주기) */
const SERVICES = ["spotify", "soundcloud", "sponsorblock", "potoken", "ai", "lastfm", "listenbrainz", "animethemes", "anisongdb", "anilist", "vocadb", "utaitedb", "touhoudb", "github", "modelsdev", "discord"] as const;
type Service = (typeof SERVICES)[number];

/** 한 번 부른 결과. error 는 짧은 까닭("timeout" · "HTTP 503" · 연결 오류 코드) */
type Outcome = { at: number; ok: boolean; ms: number; error: string | null };

/** 서비스마다 최근 몇 번을 둔다(느림 · 잦은 실패를 본다) */
const RECENT = 10;

const book = new Map<Service, { recent: Outcome[]; lastOkAt: number | null }>();

function record(service: Service, { ok, ms, error = null }: { ok: boolean; ms: number; error?: string | null }) {
  const at = Date.now();
  const entry = book.get(service) ?? { recent: [], lastOkAt: null };
  entry.recent.push({ at, ok, ms, error: ok ? null : error });
  if (entry.recent.length > RECENT) entry.recent.shift();
  if (ok) entry.lastOkAt = at;
  book.set(service, entry);
}

/** 그 서비스의 최근 결과(오래된 것부터)와 마지막 성공 때. 한 번도 부르지 않았으면 null */
function linkStatus(service: Service): { recent: readonly Outcome[]; lastOkAt: number | null } | null {
  return book.get(service) ?? null;
}

/** 테스트: 남긴 것을 비운다 */
function _reset() {
  book.clear();
}

export { SERVICES, RECENT, record, linkStatus, _reset };
export type { Service, Outcome };
