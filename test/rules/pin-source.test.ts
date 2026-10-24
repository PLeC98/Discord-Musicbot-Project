// src/rules/pin-source.ts — 캐시 DB 에서 직접 지정할 음원 · 새 행의 원래 링크가 쓸 수 있는 주소인가
import test from "node:test";
import assert from "node:assert";
import { checkPinAudio, checkPinRequest } from "../../src/rules/pin-source.ts";

test("지정할 음원: 유튜브 영상은 보는 주소 하나로(재생목록 파라미터 · 짧은 주소도 영상으로)", () => {
  for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=30", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) {
    assert.deepEqual(checkPinAudio(url), { ok: true, canonical: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "youtube", audioKey: "yt:dQw4w9WgXcQ" }, url);
  }
  assert.deepEqual(checkPinAudio("https://www.youtube.com/playlist?list=PL123"), { ok: false, code: "not-single-track" });
});

test("지정할 음원: 사운드클라우드는 곡만, 짧은 링크는 받지 않는다", () => {
  const track = checkPinAudio("https://soundcloud.com/kikuo/aiyaiyai");
  assert.ok(track.ok && track.audioKey === "sc:kikuo/aiyaiyai");
  assert.deepEqual(checkPinAudio("https://on.soundcloud.com/abc123"), { ok: false, code: "sc-unsupported" });
  assert.deepEqual(checkPinAudio("https://soundcloud.com/kikuo/sets/best"), { ok: false, code: "not-single-track" });
});

test("지정할 음원: 직접 링크는 받고(음원인지는 열 때 본다), 스포티파이 · 검색어 · 알려진 사이트의 다른 주소는 막는다", () => {
  for (const url of ["https://files.example.net/song.mp3", "https://radio.example.net:8000/live"]) {
    const direct = checkPinAudio(url);
    assert.ok(direct.ok && direct.kind === "direct" && direct.audioKey.startsWith("dl:"), url);
  }
  assert.deepEqual(checkPinAudio("https://open.spotify.com/track/3dPQuX8Gs42Y7b454ybpMR"), { ok: false, code: "not-audio-source" });
  assert.deepEqual(checkPinAudio("yoasobi idol"), { ok: false, code: "unsupported-link" });
  assert.deepEqual(checkPinAudio("https://www.youtube.com/@channel"), { ok: false, code: "unsupported-link" });
});

test("원래 링크: 곡 하나의 링크만, 링크 데이터와 같은 형식으로", () => {
  assert.deepEqual(checkPinRequest("https://open.spotify.com/intl-ko/track/3dPQuX8Gs42Y7b454ybpMR?si=x"), { ok: true, canonical: "https://open.spotify.com/track/3dPQuX8Gs42Y7b454ybpMR", platform: "spotify" });
  assert.deepEqual(checkPinRequest("https://youtu.be/dQw4w9WgXcQ"), { ok: true, canonical: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" });
  for (const url of ["https://open.spotify.com/album/abc", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123", "https://soundcloud.com/kikuo/sets/best", "yoasobi idol"]) {
    assert.deepEqual(checkPinRequest(url), { ok: false, code: "not-single-track" }, url);
  }
  assert.deepEqual(checkPinRequest("https://open.spotify.com/episode/abc"), { ok: false, code: "unsupported-link" });
});
