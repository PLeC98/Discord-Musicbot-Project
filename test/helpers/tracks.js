// 테스트용 트랙. 소스가 만드는 모양 그대로 링크 칸 셋(pageUrl · requestKey · audioUrl)을 채운다.
// 스포티파이는 영상을 찾기 전이라 audioUrl 이 없다.

const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

const youtube = (id, extra = {}) => ({ id, title: `곡 ${id}`, artist: "가수", pageUrl: watch(id), requestKey: watch(id), audioUrl: watch(id), platform: "youtube", duration: 180, ...extra });

function spotify(id, extra = {}) {
  const url = `https://open.spotify.com/track/${id}`;
  return { id, title: "스포티파이 곡", artist: "가수", pageUrl: url, requestKey: url, platform: "spotify", duration: 200, ...extra };
}

const direct = (url, extra = {}) => ({ id: url, title: "직접", artist: "직접 링크", pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", duration: 0, ...extra });

const exported = { watch, youtube, spotify, direct };
export default exported;
export { exported as "module.exports" };
