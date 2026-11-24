/**
 * 곡이 어디서 왔는지. 디스코드 화면과 대시보드(서버는 ID만 내려준다)가 같이 본다. 화면에 보이는 이름은 문구표(labels.platform)가 만든다(서비스 이름은 여기 표기 그대로, 직접 링크만 말로).
 *
 * 소스를 더하면 여기만 고치면 된다. 화면이 저마다 목록을 들면 한쪽만 고치게 된다.
 * 점 색은 대시보드 테마에 달린 값이라 화면(ServerView.vue)에 있고, 이 키 목록(Platform)으로 빠짐없이 적는다.
 */
const PLATFORMS = ["youtube", "spotify", "soundcloud", "direct", "lastfm", "lbradio", "animethemes", "anisongdb", "vocadb", "utaitedb", "touhoudb"] as const;
type Platform = (typeof PLATFORMS)[number];
const isPlatform = (v: unknown): v is Platform => PLATFORMS.some((one) => one === v);

/** 서비스 이름. 그 서비스가 쓰는 표기라 언어마다 같다. 직접 링크는 서비스가 아니라서 문구표가 말로 쓴다 */
const PLATFORM_NAMES: Record<Exclude<Platform, "direct">, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  lastfm: "Last.fm",
  lbradio: "ListenBrainz Radio",
  animethemes: "AnimeThemes",
  anisongdb: "AnisongDB",
  vocadb: "VocaDB",
  utaitedb: "UtaiteDB",
  touhoudb: "TouhouDB",
};

/** 서비스 이름. 모르는 값(direct 포함)은 첫 글자만 대문자로 올리고, 빈 값은 "-" */
function platformName(platform: string | null | undefined) {
  if (!platform) return "-";
  return Object.hasOwn(PLATFORM_NAMES, platform) ? PLATFORM_NAMES[platform as keyof typeof PLATFORM_NAMES] : platform.charAt(0).toUpperCase() + platform.slice(1);
}

export { PLATFORMS, PLATFORM_NAMES, isPlatform, platformName };
export type { Platform };
