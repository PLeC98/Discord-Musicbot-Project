// 연령 제한 콘텐츠를 틀어도 되는가. 연령 제한으로 알게 된 곳(yt-dlp 의 연령 제한 오류 · 적어 둔 영상)과 캐시로 틀 때가 부른다.
//   운영자가 꺼 두었으면(config/age-content) age-content-off
//   서버가 연령 제한 채널에서만(store/guild-settings 의 agePlace, 기본)인데 봇이 든 음성 채널이 연령 제한 채널이 아니면 age-channel-only
// 어느 서버의 일인지는 문맥(infra/guild-context)으로 안다. 문맥 밖(대시보드 재생 테스트 · 스크립트)은 운영자 판단만 본다.
// 봇이 든 음성 채널은 디스코드 쪽이 알므로 앱 조립이 알려 주는 함수를 붙인다(usePlace). 봇이 아직 음성에 없으면 모른다: 곡을 찾을 때는 막지 않고,
// 틀 때(음성에 붙은 뒤) 다시 본다

import { ageContentOn } from "../config/age-content.ts";
import { codedError } from "../rules/error-kind.ts";
import { currentGuild } from "../infra/guild-context.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";

/** 서버에서 봇이 든 음성 채널이 연령 제한 채널인가. 음성에 없으면 null */
type PlaceOf = (guildId: string) => boolean | null;

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
  if (placeOf(guildId) === false) throw codedError("age-channel-only", `연령 제한 채널이 아닌 음성 채널입니다 (${what})`, options);
}

export { assertAgeAllowed, usePlace };
