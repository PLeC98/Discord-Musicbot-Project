// 자동재생 소스를 지금 쓸 수 있는가. 키가 필요한 소스는 그 키가 있어야 한다(운영자 패널의 API · 쿠키 탭 → store/service-keys 가 설정 객체에 올린다).
// 소스 표(schema/genre-sources)는 대시보드 화면도 부르므로 설정을 읽지 않고, 키를 읽는 것은 여기서 한다

import config from "./index.ts";
import { SPEC } from "./schema/genre-sources.ts";

// 소스 표의 env(필요한 키 이름) → 그 값
const KEYS: Record<string, () => string | null | undefined> = {
  LASTFM_API_KEY: () => config.sources?.lastfmKey,
  LISTENBRAINZ_TOKEN: () => config.sources?.listenbrainzToken,
};

/** 그 소스를 쓸 수 있는가. 모르는 소스 · 읽는 법을 모르는 키는 쓸 수 없다 */
function usable(type: string): boolean {
  const spec = SPEC[type];
  if (!spec) return false;
  return !spec.env || Boolean(KEYS[spec.env]?.());
}

export { usable };
