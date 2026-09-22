/**
 * 곡이 어디서 왔는지. 이름표 하나를 디스코드 임베드와 대시보드가 같이 본다.
 *
 * 소스를 더하면 여기만 고치면 된다. 화면이 저마다 목록을 들면 한쪽만 고치게 된다
 * (자동재생 소스 여섯이 대시보드에서 회색 점으로 남아 있던 것이 그 꼴이었다).
 *
 * 이모지는 임베드에만 쓰이므로 MusicEmbedManager 에 두었고,
 * 점 색은 대시보드 테마에 달린 값이라 ServerView.vue 의 PLATFORM_COLORS 에 있다.
 */
const PLATFORM_NAMES = {
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
function labelOf(platform) {
  if (!platform) return "-";
  return PLATFORM_NAMES[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

module.exports = { PLATFORM_NAMES, labelOf };
