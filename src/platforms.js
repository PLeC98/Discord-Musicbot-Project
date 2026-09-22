/**
 * 곡이 어디서 왔는지. 이름표와 이모지 하나를 디스코드 임베드와 슬래시 명령이 같이 본다.
 *
 * 소스를 더하면 여기만 고치면 된다. 화면이 저마다 목록을 들면 한쪽만 고치게 된다
 * (자동재생 소스 여섯이 대시보드에서 회색 점으로 남아 있던 것이 그 꼴이었다).
 *
 * 점 색은 대시보드 테마에 달린 값이라 ServerView.vue 의 PLATFORM_COLORS 에 있다.
 * 브라우저가 src/ 를 못 읽어서 어쩔 수 없다.
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

// 앞의 넷은 사용자가 직접 넣는 경로, 나머지는 자동재생이 출처에서 받아 온 곡들이다
// (소리는 유튜브나 그쪽 음원에서 온다).
const PLATFORM_EMOJI = {
  youtube: "🔴",
  spotify: "🟢",
  soundcloud: "🟠",
  direct: "🔗",
  lastfm: "🔺",
  lbradio: "🧠",
  animethemes: "🎌",
  anisongdb: "🎏",
  vocadb: "🎹",
  utaitedb: "🎤",
  touhoudb: "⛩️",
};

/** 모르는 값은 첫 글자만 대문자로 올린다. */
function labelOf(platform) {
  if (!platform) return "-";
  return PLATFORM_NAMES[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** 모르는 값은 음표. 빈 자리로 두면 줄이 어긋나 보인다. */
function emojiOf(platform) {
  return PLATFORM_EMOJI[platform] || "🎵";
}

module.exports = { PLATFORM_NAMES, PLATFORM_EMOJI, labelOf, emojiOf };
