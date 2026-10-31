// src/player/failure-scope.ts: 곡을 못 틀었을 때 그 까닭이 이 곡만인가(track), 다음 곡도인가(environment), 모르는가(unknown).
// 넘길지, 셀지, 그 곡에서 멈출지가 이것으로 갈리므로, 망이 끊긴 것을 곡 탓으로 보면 대기열을 태우고, 죽은 곡을 환경 탓으로 보면 곡마다 멈춘다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { failureScope, TRACK, ENVIRONMENT, UNKNOWN } from "../../src/player/failure-scope.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import { SsrfError } from "../../src/infra/safe-url.ts";

const coded = (code: string, extra: object = {}) => Object.assign(codedError(code, code), extra);

test("이름: 곡의 성질, 그 곡에만 걸리는 설정은 곡 탓, 다음 곡도 막히는 것은 환경 탓, 근거 없는 것은 모름", () => {
  for (const code of ["unavailable-contents", "sc-preview-only", "geo-blocked", "age-content-off", "age-channel-only", "yt-age-no-cookies", "yt-age-cookies-invalid", "sp-no-youtube-match", "unsupported-link", "shoutcast-v1", "pinned-live"]) {
    assert.equal(failureScope(coded(code)), "track", code);
  }
  for (const code of ["network-error", "rate-limited", "yt-bot-check", "encoder-unavailable"]) assert.equal(failureScope(coded(code)), "environment", code);
  for (const code of ["stream-failed", "no-audio-only", "client-fault", "stale-media", "skipped-client", "no-formats", "새로운-이름"]) assert.equal(failureScope(coded(code)), "unknown", code);
  assert.equal(failureScope(new Error("이름 없음")), "unknown");
});

test("연결 이름(Node, undici), 시간 초과는 환경 탓. 원인 사슬에 있어도", () => {
  for (const code of ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"]) {
    assert.equal(failureScope(new Error("fetch failed", { cause: coded(code) })), "environment", code);
  }
  assert.equal(failureScope(Object.assign(new Error("시간 초과"), { name: "TimeoutError" })), "environment");
});

test("만든 곳이 붙인 범위가 이름보다 먼저다(같은 stream-failed 라도)", () => {
  assert.equal(failureScope(coded("stream-failed", { scope: "environment" })), "environment", "ffmpeg 없음");
  assert.equal(failureScope(coded("stream-failed", { scope: "track" })), "track", "이 곡에 mp3 없음");
  assert.equal(failureScope(new Error("감쌈", { cause: coded("stream-failed", { scope: "environment" }) })), "environment");
});

test("스트림의 HTTP 상태: 없어졌으면(404, 410) 곡 탓, 막혔으면(401, 403, 429, 5xx) 환경 탓. '다시 받지 마라'(permanent) 표시는 보지 않는다", () => {
  const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, permanent: status < 500 });
  assert.deepEqual(
    [404, 410].map((s) => failureScope(http(s))),
    ["track", "track"],
  );
  assert.deepEqual(
    [401, 403, 429, 500, 503].map((s) => failureScope(http(s))),
    Array(5).fill("environment"),
    "googlevideo 차단 · 요청 제한에 대기열을 태우지 않는다",
  );
  assert.equal(failureScope(http(416)), "unknown");
});

test("직접 링크: 없어졌으면 곡 탓, 그 밖의 상태, 연결 실패는 모름(링크마다 서버가 다르다). ffmpeg 같은 봇 쪽은 그대로 환경 탓", () => {
  const direct = { direct: true };
  assert.equal(failureScope(coded("direct-unavailable", { cause: new Error("요청 실패: HTTP 404") }), direct), "track");
  assert.equal(failureScope(coded("direct-unavailable", { cause: new Error("요청 실패: HTTP 403") }), direct), "unknown", "핫링크 차단 · 만료된 서명 주소");
  assert.equal(failureScope(Object.assign(new Error("HTTP 403"), { status: 403 }), direct), "unknown");
  assert.equal(failureScope(coded("direct-unavailable", { cause: coded("ECONNREFUSED") }), direct), "unknown");
  assert.equal(failureScope(coded("network-error"), direct), "unknown");
  assert.equal(failureScope(coded("encoder-unavailable"), direct), "environment");
  assert.equal(failureScope(coded("stream-failed", { scope: "environment" }), direct), "environment");
  assert.equal(failureScope(coded("direct-unavailable", { cause: new SsrfError("내부 주소") }), direct), "track", "안전하지 않은 주소");
});

test("죽은 음원 판정(deadSourceCode)과 어긋나지 않는다: 그것이 사라졌다고 보면 곡 탓", () => {
  assert.equal(failureScope(new Error("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader")), "track");
  assert.equal(failureScope(coded("direct-unavailable", { cause: new Error("요청 실패: HTTP 410") })), "track");
});

// 재생 쪽에서 만드는 이름이 빠짐없이 어느 표에 있는가. 새 이름을 만들면 갈래를 정하게 한다(표에 없으면 모름으로 떨어진다)
test("재생 쪽에서 만드는 이름은 모두 갈래가 정해져 있다", () => {
  const root = path.join(import.meta.dirname, "..", "..", "src");
  const files = ["media", "sources", "player"].flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => path.join(e.parentPath, e.name)),
  );
  const names = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/codedError\(\s*"([a-z0-9-]+)"/g)) names.add(m[1]);
  }
  // 출처의 yt-dlp 문장 읽기가 붙이는 이름
  for (const file of ["sources/youtube/errors.ts", "sources/soundcloud/run.ts"]) {
    for (const m of fs.readFileSync(path.join(root, file), "utf8").matchAll(/return "([a-z][a-z0-9-]+)";/g)) names.add(m[1]);
  }
  // 곡을 넣을 때만 나오는 이름, 따로 다루는 이름(음성 연결 실패는 부르는 쪽이 정한다)
  const elsewhere = new Set(["not-found", "spotify-failed", "unavailable-playlist", "voice-failed"]);
  const missing = [...names].filter((n) => !elsewhere.has(n) && !TRACK.has(n) && !ENVIRONMENT.has(n) && !UNKNOWN.has(n));
  assert.deepEqual(missing, []);
});
