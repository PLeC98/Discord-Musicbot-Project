// 대시보드 서버 설정 화면이 주고받는 서버별 설정 값의 타입과 비교 함수. 화면(dashboard/src)과 봇이 같이 쓴다(Node 를 부르지 않는다).

import type { AgePlace } from "./age-place.ts";

/**
 * 서버 설정 화면이 주고받는 값. 키가 없으면 그 카드가 보이지 않는다.
 * sponsorblock.categories 가 null 이면 운영자의 기본 구간을 따른다(기본 구간을 그대로 적어 둔 배열과 다르다).
 */
type SettingsValues = {
  botChannelId?: string | null;
  djRoleIds?: string[];
  sponsorblock?: { enabled?: boolean; categories?: string[] | null };
  playlistAddMax?: number | null;
  agePlace?: AgePlace;
};

/** 보내기, 비교, 충돌 판정의 단위 */
type SettingsKey = "botChannelId" | "djRoleIds" | "sponsorblock.enabled" | "sponsorblock.categories" | "playlistAddMax" | "agePlace";

const SET_KEYS: ReadonlySet<SettingsKey> = new Set(["djRoleIds", "sponsorblock.categories"]);

const setOf = (list: readonly string[]) => [...new Set(list)].sort().join("\n");

/**
 * 키 하나의 두 값이 같은지 본다. 역할, 구간은 순서와 중복을 따지지 않는다.
 * 구간에서 undefined(카드가 안 보임), null(운영자 기본 구간을 따름), [](아무 구간도 건너뛰지 않음)은 서로 다르다
 */
function sameValue(key: SettingsKey, a: unknown, b: unknown): boolean {
  if (SET_KEYS.has(key) && Array.isArray(a) && Array.isArray(b)) return setOf(a as string[]) === setOf(b as string[]);
  return a === b;
}

export { sameValue };
export type { SettingsValues, SettingsKey };
