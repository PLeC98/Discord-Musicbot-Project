// 서버 설정 화면에 보여 주는 값. GET 응답, 저장 응답, 충돌 응답, 그사이 바뀌었는지 비교할 때 모두 이 값을 쓴다.
// 행의 값과 다르다. 지운 채널은 null 로 두고, DJ 역할은 줄 수 있는 역할만 남긴다. 정하지 않았으면 SponsorBlock 켜기는 켬, 연령 제한은 "channel" 이다.
// SponsorBlock 구간의 null 은 기본 구간 목록으로 바꾸지 않고 그대로 둔다(null 은 운영자의 기본 구간을 따름). 운영자가 기본 구간을 바꾸는 것은 서버 설정을 바꾸는 것이 아니다.
// SponsorBlock 은 전역 스위치와 상관없이 그 서버의 설정을 보여 준다(꺼진 것은 화면의 카드가 따로 알린다).

import type { Guild } from "discord.js";
import type { GuildDoc } from "../store/guild-settings.ts";
import { isDjRoleCandidate } from "../usecases/permissions.ts";
import { sameValue, valueAt, type SettingsKey, type SettingsValues } from "../rules/guild-settings-values.ts";

/** 행에 저장된 문서를 화면에 보여 주는 값으로 바꾼다(모든 키) */
function shownValues(guild: Guild, doc: GuildDoc): SettingsValues {
  return {
    botChannelId: doc.botChannelId && guild.channels.cache.has(doc.botChannelId) ? doc.botChannelId : null,
    djRoleIds: (doc.djRoleIds ?? []).filter((id) => isDjRoleCandidate(guild, id)),
    sponsorblock: { enabled: doc.sponsorBlock?.enabled ?? true, categories: doc.sponsorBlock?.categories ?? null },
    playlistAddMax: doc.playlistAddMax ?? null,
    agePlace: doc.agePlace ?? "channel",
  };
}

/**
 * 그사이 다른 곳에서 바꾼 키. 화면이 읽은 값(from)이 지금 보여 주는 값과 다르고, 지금 값이 이미 바꾸려는 값(to)도 아닌 키다.
 * to 에는 경로가 거른 뒤의 값을 넘긴다. 역할은 from 도 지금 줄 수 있는 역할로 걸러 비교한다(그사이 역할이 지워지기만 했으면 충돌이 아니다)
 */
function conflictsOf(guild: Guild, doc: GuildDoc, keys: readonly SettingsKey[], from: SettingsValues, to: SettingsValues): SettingsKey[] {
  const now = shownValues(guild, doc);
  return keys.filter((key) => {
    let read = valueAt(from, key);
    if (key === "djRoleIds" && Array.isArray(read)) read = (read as string[]).filter((id) => isDjRoleCandidate(guild, id));
    return !sameValue(key, read, valueAt(now, key)) && !sameValue(key, valueAt(to, key), valueAt(now, key));
  });
}

export { shownValues, conflictsOf };
