// 연령 제한 콘텐츠를 틀어도 되는가. 운영자가 꺼 두었으면(config/age-content) age-content-off 로 거절한다.
// 연령 제한으로 알게 된 곳(yt-dlp 의 연령 제한 오류 · 적어 둔 영상)과 캐시로 틀 때가 부른다

import { ageContentOn } from "../config/age-content.ts";
import { codedError } from "../rules/error-kind.ts";

/** what: 로그에 남길 대상(영상 id 등). cause: 연령 제한을 알린 오류 */
function assertAgeAllowed(what: string, cause?: unknown) {
  if (!ageContentOn()) throw codedError("age-content-off", `연령 제한 콘텐츠가 꺼져 있습니다 (${what})`, cause === undefined ? undefined : { cause });
}

export { assertAgeAllowed };
