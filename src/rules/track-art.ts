// 곡 그림 주소. 출처가 주는 그림은 너무 작거나(유튜브 검색 결과의 168×94 · 사운드클라우드 16×16) 너무 크거나(사운드클라우드 원본 3000×3000) 띠가 있어
// 출처마다 쓸 크기의 주소로 바꾼다. 봇(곡을 만들 때 · 디스코드 패널)과 화면이 같이 쓰고, 저장된 옛 주소도 그릴 때 이것으로 바뀐다. Node 를 부르지 않는다
//   유튜브         영상 id 로 만든다. 작은 칸은 mqdefault(320×180, 늘 있고 위아래 띠가 없다), 큰 칸은 maxresdefault(없는 영상이면 화면이 작은 것으로 돌아간다)
//   사운드클라우드  크기 접미사를 t500x500 으로(500×500)
//   그 밖          그대로

type ArtSize = "small" | "large";

const YOUTUBE_ART = /^https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]{11})\//;
const SOUNDCLOUD_ART = /^(https?:\/\/i\d*\.sndcdn\.com\/(?:artworks|avatars)-[^/?#]+?)-(?:mini|tiny|small|badge|large|crop|original|t\d+x\d+)(\.(?:jpe?g|png|webp))$/i;

/** 유튜브 영상의 그림 */
const youtubeArt = (videoId: string, size: ArtSize = "small") => `https://i.ytimg.com/vi/${videoId}/${size === "large" ? "maxresdefault" : "mqdefault"}.jpg`;

/** 그릴 그림 주소(없으면 null) */
function artOf(url: string | null | undefined, size: ArtSize = "small"): string | null {
  if (!url) return null;
  const youtube = YOUTUBE_ART.exec(url);
  if (youtube) return youtubeArt(youtube[1], size);
  const soundcloud = SOUNDCLOUD_ART.exec(url);
  if (soundcloud) return `${soundcloud[1]}-t500x500${soundcloud[2]}`;
  return url;
}

export { artOf, youtubeArt };
export type { ArtSize };
