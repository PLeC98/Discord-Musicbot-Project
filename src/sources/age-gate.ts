// 연령 제한 콘텐츠를 틀어도 되는가. 연령 제한으로 알게 된 곳(yt-dlp 의 연령 제한 오류 · 적어 둔 영상)과 캐시로 틀 때가 부른다.
//   운영자가 꺼 두었으면(config/age-content) age-content-off
//   서버가 연령 제한 채널에서만(store/guild-settings 의 agePlace, 기본)인데 봇이 든 음성 채널이 연령 제한 채널이 아니면 age-channel-only
// 어느 서버의 일인지는 문맥(infra/guild-context)으로 안다. 문맥 밖(대시보드 재생 테스트 · 스크립트)은 운영자 판단만 본다.
// 봇이 든 음성 채널은 디스코드 쪽이 알므로 앱 조립이 알려 주는 함수를 붙인다(usePlace). 봇이 아직 음성 밖이면 곡을 넣는 일이 실은 붙을 채널(inVoiceTarget)을 본다.
// 그것도 없으면 모른다: 막지 않고 틀 때(음성에 붙은 뒤) 다시 본다

import { ageContentOn } from "../config/age-content.ts";
import { codedError, codeOf, messageOf } from "../rules/error-kind.ts";
import { currentGuild, currentVoiceTarget } from "../infra/guild-context.ts";
import logger from "../infra/log/logger.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import * as externalCaches from "../store/external-caches.ts";

const log = logger.child({ category: "youtube" });

/** 서버에서 봇이 든 음성 채널(없으면 붙을 채널 target)이 연령 제한 채널인가. 둘 다 없으면 null */
type PlaceOf = (guildId: string, target: string | null) => boolean | null;

let placeOf: PlaceOf = () => null;

/** 앱 조립이 붙인다. 인자 없이 부르면 떼어 낸다(시험) */
function usePlace(fn?: PlaceOf) {
  placeOf = fn ?? (() => null);
}

/** what: 로그에 남길 대상(영상 id 등). cause: 연령 제한을 알린 오류 */
function assertAgeAllowed(what: string, cause?: unknown) {
  const options = cause === undefined ? undefined : { cause };
  if (!ageContentOn()) throw codedError("age-content-off", `연령 제한 콘텐츠가 꺼져 있습니다 (${what})`, options);
  const guildId = currentGuild();
  if (!guildId || GuildSettingsManager.resolveAgePlace(guildId) === "all") return;
  if (placeOf(guildId, currentVoiceTarget()) === false) throw codedError("age-channel-only", `연령 제한 채널이 아닌 음성 채널입니다 (${what})`, options);
}

/** 연령 제한으로 적어 둔 영상인가. 기록을 읽지 못하면 아닌 것으로 본다 */
function markedAgeRestricted(videoId: string | null | undefined) {
  if (!videoId) return false;
  try {
    return externalCaches.isAgeRestricted(videoId);
  } catch (error) {
    if (codeOf(error) === "DB_NOT_OPEN") throw error;
    log.warn(`연령 제한 기록 읽기 실패, 제한 없는 영상으로 봅니다 (${videoId}): ${messageOf(error)}`);
    return false;
  }
}

export { assertAgeAllowed, markedAgeRestricted, usePlace };
