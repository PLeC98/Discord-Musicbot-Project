// 링크 판정 셋(inputKind · canonicalUrl · audioKeyOf). 순수 함수라 입력과 답만 적는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inputKind } from "../../src/rules/input-kind.ts";
import { canonicalUrl } from "../../src/rules/canonical-url.ts";
import { audioKeyOf, md5 } from "../../src/rules/audio-key-of.ts";
import { parseSoundCloudURL } from "../../src/rules/links.ts";
test("inputKind: 사이트 호스트를 먼저 보고 확장자는 마지막에 본다", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=abcdefghijk", "youtube"],
    ["https://youtu.be/abcdefghijk", "youtube"],
    ["https://www.youtube.com/playlist?list=PLx", "youtube"],
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj", "spotify"],
    ["spotify:album:2joT0CjcGqc1fr8Fvk7itj", "spotify"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://soundcloud.com/artist/track.mp3", "soundcloud"],
    ["https://cdn.example.com/a.mp3", "direct"],
    // 유튜브 호스트지만 모르는 형태. 확장자가 맞으면 직접 링크가 된다(지금 답 그대로)
    ["https://www.youtube.com/clip/abc", "unknown"],
    ["https://www.youtube.com/x.mp3", "direct"],
    ["https://anilist.co/anime/1", "unknown"],
    ["http://example.com/page", "unknown"],
    ["그냥 검색어", "search"],
    ["youtube.com/watch?v=abcdefghijk", "search"], // 주소처럼 생겨도 http(s) 가 없으면 검색어다
    [undefined, "search"],
  ];
  for (const [input, want] of cases) assert.equal(inputKind(input), want, String(input));
});

test("canonicalUrl: 사이트마다 같은 곡의 공유 링크를 한 모양으로, 직접 링크와 모르는 것은 그대로", () => {
  const cases = [
    ["https://youtu.be/Lsv4wg9YU8Y?si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://music.youtube.com/watch?v=Lsv4wg9YU8Y&list=RDx", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://www.youtube.com/playlist?list=PLx", "https://www.youtube.com/playlist?list=PLx"], // 영상 id 가 없으면 그대로
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj"],
    ["https://open.spotify.com/intl-ko/album/abc?si=x", "https://open.spotify.com/album/abc"],
    ["spotify:track:2joT0CjcGqc1fr8Fvk7itj", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj"],
    ["https://m.soundcloud.com/artist/track?in=a/sets/b&utm_source=x", "https://soundcloud.com/artist/track"],
    ["https://on.soundcloud.com/AbCd", "https://on.soundcloud.com/AbCd"],
    ["https://cdn.example.com/a.mp3?token=abc", "https://cdn.example.com/a.mp3?token=abc"],
    ["https://anilist.co/anime/1?x=1", "https://anilist.co/anime/1?x=1"],
    ["검색어", "검색어"],
  ];
  for (const [input, want] of cases) assert.equal(canonicalUrl(input), want, input);
  assert.equal(canonicalUrl(null), null, "글자가 아니면 그대로 돌려준다");
});

test("audioKeyOf: 음원 주소 하나만 보고 사이트마다 열쇠 모양", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=abcdefghijk&list=RDx", "yt:abcdefghijk"],
    ["https://youtu.be/abcdefghijk?si=x", "yt:abcdefghijk"],
    ["https://www.youtube.com/playlist?list=PLx", null], // 영상이 아니면 열쇠가 없다
    ["https://soundcloud.com/artist/track?in=a/sets/b", "sc:artist/track"],
    ["https://m.soundcloud.com/artist/track", "sc:artist/track"],
    ["https://on.soundcloud.com/AbCd", "sc:on.soundcloud.com/AbCd"],
    ["https://api-v2.soundcloud.com/tracks/368141150", "sc:api-v2.soundcloud.com/tracks/368141150"], // 재생목록을 훑어 읽은 곡
    ["https://cdn.example.com/a.mp3", `dl:${md5("https://cdn.example.com/a.mp3")}`],
    ["https://cdn.example.com/a.mp3?token=1", `dl:${md5("https://cdn.example.com/a.mp3?token=1")}`], // 서명된 주소는 쿼리까지
    // 자동재생 음원(AnisongDB 는 소리 · 영상 파일, AnimeThemes 는 ogg). 확장자가 있어야 직접 링크로 받는다
    ["https://nawdist.animemusicquiz.com/abcdef.mp3", `dl:${md5("https://nawdist.animemusicquiz.com/abcdef.mp3")}`],
    ["https://nawdist.animemusicquiz.com/abcdef.webm", `dl:${md5("https://nawdist.animemusicquiz.com/abcdef.webm")}`],
    ["https://a.animethemes.moe/Title-OP1.ogg", `dl:${md5("https://a.animethemes.moe/Title-OP1.ogg")}`],
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj", null], // 소리가 여기서 오지 않는다
    ["https://anilist.co/anime/1", null],
    [undefined, null],
  ];
  for (const [input, want] of cases) assert.equal(audioKeyOf(input), want, String(input));
});

// 받는 것은 곡과 세트뿐이다. 프로필 · 좋아요 같은 모음은 곡 링크로 잘못 알아보지 않는다
test("사운드클라우드 주소가 가리키는 것: 곡 · 세트 · 짧은 링크 · 그 밖", () => {
  const cases = [
    ["https://soundcloud.com/artist/track-name", "track"],
    ["https://m.soundcloud.com/artist/track?in=a/sets/b", "track"],
    ["https://soundcloud.com/artist/track/s-AbC123", "track"], // 비밀 공유
    ["https://api.soundcloud.com/tracks/368141150", "track"],
    ["https://api-v2.soundcloud.com/tracks/368141150", "track"],
    ["https://soundcloud.com/artist/sets/list", "set"],
    ["https://soundcloud.com/artist/sets/list/s-XyZ9", "set"],
    ["https://api.soundcloud.com/playlists/2284916349", "set"],
    ["https://on.soundcloud.com/AbCd", "short"],
    ["https://soundcloud.com/artist", "other"],
    ["https://soundcloud.com/artist/likes", "other"],
    ["https://soundcloud.com/artist/reposts", "other"],
    ["https://soundcloud.com/artist/sets", "other"],
    ["https://soundcloud.com/artist/tracks", "other"],
    ["https://soundcloud.com/artist/track/extra/more", "other"],
    ["https://www.youtube.com/watch?v=abcdefghijk", null],
  ];
  for (const [input, want] of cases) assert.equal(parseSoundCloudURL(input), want, String(input));
});
