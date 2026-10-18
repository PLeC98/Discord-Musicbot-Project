// 곡 그림 주소. 출처가 주는 그림은 너무 작거나(유튜브 검색 결과의 168×94 · 사운드클라우드 16×16) 너무 크거나(사운드클라우드 원본 3000×3000) 띠가 있어
// 출처마다 쓸 크기의 주소로 바꾼다. 봇(곡을 만들 때 · 디스코드 패널)과 화면이 같이 쓰고, 저장된 옛 주소도 그릴 때 이것으로 바뀐다. Node 를 부르지 않는다
//   유튜브         영상 id 로 만든다. 작은 칸은 mqdefault(320×180, 늘 있고 위아래 띠가 없다), 큰 칸은 maxresdefault(1280×720, 옛 영상에는 없다),
//                  standard 는 hqdefault(480×360, 늘 있고 4:3 이라 위아래 띠가 있다. 큰 그림이 없을 때)
//   사운드클라우드  크기 접미사를 t500x500 으로(500×500)
//   그 밖          그대로

type ArtSize = "small" | "large" | "standard";
const YOUTUBE_SIZE = { small: "mqdefault", large: "maxresdefault", standard: "hqdefault" } as const satisfies Record<ArtSize, string>;

const YOUTUBE_ART = /^https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]{11})\//;
const SOUNDCLOUD_ART = /^(https?:\/\/i\d*\.sndcdn\.com\/(?:artworks|avatars)-[^/?#]+?)-(?:mini|tiny|small|badge|large|crop|original|t\d+x\d+)(\.(?:jpe?g|png|webp))$/i;

/** 유튜브 영상의 그림 */
const youtubeArt = (videoId: string, size: ArtSize = "small") => `https://i.ytimg.com/vi/${videoId}/${YOUTUBE_SIZE[size]}.jpg`;

/** 유튜브 그림 주소의 영상 id(유튜브 그림이 아니면 null) */
const youtubeIdOf = (url: string | null | undefined) => (url ? (YOUTUBE_ART.exec(url)?.[1] ?? null) : null);

/** 그릴 그림 주소(없으면 null) */
function artOf(url: string | null | undefined, size: ArtSize = "small"): string | null {
  if (!url) return null;
  const videoId = youtubeIdOf(url);
  if (videoId) return youtubeArt(videoId, size);
  const soundcloud = SOUNDCLOUD_ART.exec(url);
  if (soundcloud) return `${soundcloud[1]}-t500x500${soundcloud[2]}`;
  return url;
}

export { artOf, youtubeArt, youtubeIdOf };
export type { ArtSize };
