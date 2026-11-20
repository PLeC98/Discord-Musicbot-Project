// 라벨 문장. 다른 문장 안에 끼워 쓰는 짧은 말

import { platformName } from "../../../rules/platforms.ts";

// 여러 곡을 한 번에 추가한 출처의 표시 이름 (sources/lookup의 collection 값). 모르면 재생목록
const COLLECTION: Record<"playlist" | "album" | "artist", string> = { playlist: "재생목록", album: "앨범", artist: "아티스트 인기곡" };
const collection = (kind: string | null | undefined) => (kind && Object.hasOwn(COLLECTION, kind) ? COLLECTION[kind as keyof typeof COLLECTION] : "재생목록");

/** 곡 제목. 출처가 제목을 주지 않았으면(null) 알 수 없는 곡 */
const songTitle = (title: string | null | undefined) => title || "알 수 없는 곡";

const trackCount = (n: number) => `${n}곡`;

/** 길이를 말로. "3일 4시간 5분", "1시간 5분". 0인 단위는 빼고, 다 0이면 "0분" */
function span(seconds: number) {
  const total = Math.floor(seconds);
  const units: Array<[number, string]> = [
    [Math.floor(total / 86400), "일"],
    [Math.floor((total % 86400) / 3600), "시간"],
    [Math.floor((total % 3600) / 60), "분"],
  ];
  const parts = units.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`);
  return parts.length ? parts.join(" ") : "0분";
}

/** 시작 전 라이브(예정된 방송, 최초 공개)의 길이 자리 */
const upcomingLive = () => "예정된 라이브";

/** 곡이 온 곳(rules/platforms)의 이름. 서비스 이름은 그 표기 그대로, 직접 링크만 말로 */
const platform = (id: string | null | undefined) => (id === "direct" ? "직접 링크" : platformName(id));

export { collection, songTitle, trackCount, span, upcomingLive, platform };
