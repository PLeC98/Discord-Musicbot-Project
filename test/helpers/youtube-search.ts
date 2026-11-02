// 유튜브 검색 응답의 가짜. youtubei.js 가 읽는 칸만 남겼다(실제 응답은 수백 KB 이고 IP, 방문자 값이 들어 있다)

// sw.js_data: 세션을 만들 때 받는 기기 정보. youtubei.js 는 [0][2][0][0] 의 칸 번호로 읽는다(0 언어, 1 지역, 13 방문자, 16 클라이언트 버전)
function sessionData() {
  const device: unknown[] = Array(80).fill(null);
  Object.assign(device, { 0: "en", 1: "KR", 3: "0.0.0.0", 13: "visitor", 16: "2.20251020.00.00", 17: "Windows", 18: "10.0" });
  return `)]}'\n${JSON.stringify([["yt.sw.adr", null, [[device], "key"]]])}`;
}

type Video = { id: string; title: string; channel?: string; length?: string; live?: boolean };
const video = ({ id, title, channel = "채널", length, live = false }: Video) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: "UCxxxxxxxxxxxxxxxxxxxxxx" } } }] },
    thumbnail: { thumbnails: [] },
    ...(length ? { lengthText: { simpleText: length } } : {}),
    // 썸네일 위 길이 자리. 라이브는 LIVE 모양
    thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: live ? "LIVE" : (length ?? "") }, style: live ? "LIVE" : "DEFAULT" } }],
    ...(live ? { badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }] } : {}),
  },
});
const GATE = { backgroundPromoRenderer: { title: { runs: [{ text: "Confirm your age" }] }, bodyText: { runs: [{ text: "These results may be inappropriate for some users." }] } } };
const UNKNOWN = { lockupViewModel: { contentId: "abcdefghijk" } };
const searchPage = (items: unknown[]) => JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } });

export { sessionData, video, searchPage, GATE, UNKNOWN };
