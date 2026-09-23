"use strict";

// ListenBrainz Radio 소스.

const config = require("../../../config");
const { query, getJson } = require("./http");

// LB Radio는 재생목록을 그때그때 짜 주느라 느리다(실측 5~15초, 더 걸리기도 한다).
// 15초로는 자주 끊겨 멀쩡한 소스가 빈손으로 취급된다.
const SLOW_MS = 30000;

// ── lbradio ───────────────────────────────────────────────────────────────
// 호출마다 50곡을 새로 짠다. 길이를 준다(병 유형). youtubeMatch의 길이 신호가 켜진다.
async function lbradio(source) {
  const token = config.sources?.listenbrainzToken;
  if (!token) throw new Error("LISTENBRAINZ_TOKEN이 없습니다");
  // 기본은 hard다. 이름과 반대로 hard 쪽이 더 알려진 곡을 준다. 모드는 태그 폭을 바꾼다
  // (easy는 적은 태그만, hard는 비슷한 태그까지 끌어와서 그만큼 큰 아티스트가 섞인다).
  const modes = [].concat(source.mode || "hard");

  // mode 파라미터는 하나만 받지만(둘을 주면 400), 프롬프트 안에서는 원소마다 지정할 수 있다.
  // 그래서 `mode: [easy, hard]` 를 한 번의 요청으로 섞을 수 있다. 50곡을 나눠 채워 준다.
  const tagPart = source.tags?.length ? `tag:(${source.tags.join(",")})` : "";
  const prompt = source.prompt || (tagPart ? modes.map((m) => `${tagPart}::${m}`).join(" ") : "");
  if (!prompt) return [];

  const url = `https://api.listenbrainz.org/1/explore/lb-radio?${query({ prompt, mode: modes[0] })}`;
  const list = (await getJson(url, { Authorization: `Token ${token}` }, SLOW_MS))?.payload?.jspf?.playlist?.track || [];
  return list
    .map((t) => ({
      artist: t.creator || "",
      title: t.title || "",
      // 200곡 중 196곡에 길이가 있었다. 없는 것은 정 유형으로 떨어져 필터를 탄다.
      durationSec: Number(t.duration) > 0 ? Math.round(Number(t.duration) / 1000) : undefined,
      sourceUrl: t.identifier?.[0] || undefined, // MusicBrainz 녹음 주소
      platform: "lbradio",
      sourceKey: String(t.identifier?.[0] || `${t.creator}|${t.title}`),
    }))
    .filter((t) => t.artist && t.title && !PLACEHOLDER.test(t.artist) && !PLACEHOLDER.test(t.title));
}

// MusicBrainz는 아티스트·곡을 모를 때 정해진 이름으로 자리를 채운다.
// 그대로 두면 그걸 유튜브에 검색하게 된다(250곡 중 1곡꼴).
//
// 대괄호로 싸였다고 다 거르면 안 된다. `[Alexandros]`는 실존하는 일본 록밴드다.
// 그래서 정해진 목록만 본다. https://musicbrainz.org/doc/Style/Unknown_and_untitled
const PLACEHOLDERS = new Set(["[no artist]", "[unknown]", "[anonymous]", "[nobody]", "[traditional]", "[data]", "[dialogue]", "[silence]", "[untitled]", "[unknown]"].map((s) => s.toLowerCase()));

const PLACEHOLDER = {
  test: (value) =>
    PLACEHOLDERS.has(
      String(value || "")
        .trim()
        .toLowerCase(),
    ),
};

module.exports = { lbradio, PLACEHOLDER };
