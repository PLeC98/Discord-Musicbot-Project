// 로그 문구: 서버 설정(guild 분류). 서버별 설정 읽기, 저장, 알림

import { josa } from "../../../src/infra/josa.ts";

const guild = {
  botChannelDeletedCleared: ({ channel, guild }: { channel: string; guild: string }) => `전용 채널 "${channel}"${josa(channel, "이")} 삭제되어 전용 채널 설정을 비움(${guild})`,
  botChannelDeletedClearFailed: ({ channel, guild, error }: { channel: string; guild: string; error: string }) => `전용 채널 "${channel}"${josa(channel, "이")} 삭제됐지만 전용 채널 설정을 비우지 못함(${guild}): ${error}`,
  guildSettingsNotifyFailed: () => `서버 설정 변경 알림 처리 실패:`,
  dedicatedChannelReadFailed: () => `전용 채널 읽기 실패:`,
  djRoleReadFailed: () => `DJ 역할 읽기 실패:`,
  playlistLimitReadFailed: () => `재생목록 1회 최대 추가 곡 수 읽기 실패(기본값 사용):`,
  ageRestrictedReadFailed: () => `연령 제한 콘텐츠 허용 범위 읽기 실패(연령 제한 채널만 허용으로 적용):`,
  volumeReadFailed: () => `서버 볼륨 읽기 실패(기본 볼륨 사용):`,
  volumeNormalizeReadFailed: () => `볼륨 정규화 설정 읽기 실패(끔으로 적용):`,
  guildLanguageReadFailed: () => `서버 언어 읽기 실패(봇 기본 언어로 적용):`,
  sponsorBlockReadFailed: () => `SponsorBlock 설정 읽기 실패(전역 설정 적용):`,
  panelPlaceReadFailed: () => `현재 재생 패널 위치 읽기 실패(이전 패널 정리 생략):`,
  panelPlaceSaveFailed: () => `현재 재생 패널 위치 저장 실패:`,
  guildSettingsJsonInvalid: ({ guildId }: { guildId: string }) => `서버 ${guildId} 설정 읽기 실패(기본값 사용): 올바른 JSON 형식이 아님`,
  guildSettingsValueInvalid: ({ guildId, fields }: { guildId: string; fields: string }) => `서버 ${guildId} 설정의 ${fields} 값 검증 실패(기본값 사용)`,
  fieldBotChannel: () => `전용 채널`,
  fieldDjRoles: () => `DJ 역할`,
  fieldPlaylistAddMax: () => `재생목록 한 번에 넣을 곡 수`,
  fieldAgePlace: () => `연령 제한 콘텐츠를 틀 곳`,
  fieldVolume: () => `볼륨`,
  fieldNormalize: () => `볼륨 정규화`,
  fieldLanguage: () => `서버 언어`,
  guildLeft: ({ name, id }: { name: string; id: string }) => `서버에서 나감: ${name} (${id}). 저장된 대기열, 패널 위치, 음성 채널 상태 삭제`,
  goneGuildCleaned: ({ name, id }: { name: string; id: string }) => `끊긴 동안 나간 서버 정리: ${name} (${id})`,
  disposeGuildLeft: () => `서버에서 나감`,
};

export { guild };
