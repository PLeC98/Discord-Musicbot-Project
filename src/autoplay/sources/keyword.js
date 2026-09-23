// 키워드 소스.

import http from "./http.js";
const { pick } = http;
import YouTube from "../../sources/youtube/index.js";

// ── keyword ───────────────────────────────────────────────────────────────
// 옛 길. 유튜브 검색 결과를 그대로 후보로 삼는다. 품질이 제일 낮으니 weight를 낮게 주는 편이 낫다.
async function keyword(source) {
  const word = pick(source.keywords || []);
  if (!word) return [];
  const results = (await YouTube.search(word, 15)) || [];
  // fromSearch: 검색 결과라 제목을 못 믿는다는 표시다. AI 보조가 이것만 판정한다(autoplayAssist)
  // 주소를 직접 주는 소스는 출처가 곧 정답이라 물을 것이 없다.
  return results.filter((r) => r.audioUrl && !r.isLive).map((r) => ({ title: r.title, durationSec: r.duration, youtubeUrl: r.audioUrl, thumbnail: r.thumbnail, fromSearch: true, sourceKey: `yt:${r.id}` }));
}

const exported = { keyword };
export default exported;
export { exported as "module.exports" };
