// 서버에서 연령 제한 콘텐츠를 어디서 틀지(운영자가 연령 제한 콘텐츠를 켰을 때). 판정은 sources/age-gate, 저장은 store/guild-settings.
// channel: 연령 제한 음성 채널에서만(기본. 디스코드가 성인 확인을 한 사람만 들어간다) · all: 모든 음성 채널

const AGE_PLACES = ["channel", "all"] as const;
type AgePlace = (typeof AGE_PLACES)[number];

export { AGE_PLACES };
export type { AgePlace };
