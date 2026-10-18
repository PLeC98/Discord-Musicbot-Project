// 곡의 출처(서비스)를 대표하는 색. 서버 화면의 출처 배지 · 대기열 행의 점이 쓴다

import { isPlatform, type Platform } from "../../../src/rules/platforms.ts";

// 키는 rules/platforms 의 Platform 이라 하나라도 빠지면 타입 검사가 잡는다(빠지면 회색 점이 되어 어디서 온 곡인지 안 보인다)
const PLATFORM_COLORS: Record<Platform, string> = {
  youtube: "#ff0000",
  spotify: "#1db954",
  soundcloud: "#ff5500",
  direct: "var(--md-primary)",
  lastfm: "#d92323",
  lbradio: "#eb743b", // ListenBrainz 의 --bs-primary
  animethemes: "#ffffff", // 로고 배경
  anisongdb: "#f2a93b", // 사이트 강조색
  vocadb: "#39c5bb", // 미쿠
  utaitedb: "#00688f", // 배경에 박아 둔 Ado 로고의 장미
  touhoudb: "#4f2347", // (구) 공식 트위터 프로필 이미지 배경
};

/** 모르는 출처는 회색 */
export const platformColor = (p: string) => (isPlatform(p) ? PLATFORM_COLORS[p] : "#8b93a7");
