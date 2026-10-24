// 라벨 문장. 다른 문장 안에 끼워 쓰는 짧은 말

// 여러 곡을 한 번에 담은 출처의 표시 이름 (sources/lookup 의 collection 값). 모르면 재생목록
const COLLECTION: Record<string, string> = { playlist: "재생목록", album: "앨범", artist: "아티스트 인기곡" };
const collection = (kind: string | null | undefined) => (kind && COLLECTION[kind]) || "재생목록";

/** 곡 제목. 출처가 제목을 주지 않았으면(null) 알 수 없는 곡 */
const songTitle = (title: string | null | undefined) => title || "알 수 없는 곡";

/** 곡 수 */
const trackCount = (n: number) => `${n}곡`;

export { collection, songTitle, trackCount };
