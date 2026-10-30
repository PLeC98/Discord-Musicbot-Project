/**
 * 곡이 어디서 왔는지. 라벨과 이모지 하나를 디스코드 화면과 대시보드(서버가 ID 와 라벨을 같이 내려준다)가 같이 본다.
 *
 * 소스를 더하면 여기만 고치면 된다. 화면이 저마다 목록을 들면 한쪽만 고치게 된다.
 * 점 색은 대시보드 테마에 달린 값이라 화면(ServerView.vue)에 있고, 이 키 목록(Platform)으로 빠짐없이 적는다.
 */
const PLATFORMS = ["youtube", "spotify", "soundcloud", "direct", "lastfm", "lbradio", "animethemes", "anisongdb", "vocadb", "utaitedb", "touhoudb"] as const;
type Platform = (typeof PLATFORMS)[number];
const isPlatform = (v: unknown): v is Platform => PLATFORMS.some((one) => one === v);

const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  direct: "직접 링크",
  lastfm: "Last.fm",
  lbradio: "ListenBrainz Radio",
  animethemes: "AnimeThemes",
  anisongdb: "AnisongDB",
  vocadb: "VocaDB",
  utaitedb: "UtaiteDB",
  touhoudb: "TouhouDB",
};

/** 모르는 값은 첫 글자만 대문자로 올린다. */
function labelOf(platform: string | null | undefined) {
  if (!platform) return "-";
  return isPlatform(platform) ? PLATFORM_NAMES[platform] : platform.charAt(0).toUpperCase() + platform.slice(1);
}

export { PLATFORMS, PLATFORM_NAMES, isPlatform, labelOf };
export type { Platform };
