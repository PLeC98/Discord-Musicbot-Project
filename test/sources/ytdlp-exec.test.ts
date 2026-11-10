// src/sources/ytdlp-exec.ts: 플래그를 인자로 바꾸고 yt-dlp 를 띄운다. 인자는 youtube-dl-exec 3.1.19(dargs 7, tinyspawn 1.5)가 내던 것을 그대로 굳혔다(경우마다 그 라이브러리로 뽑은 값).
// 띄우기는 yt-dlp 대신 Node 를 띄워 본다: 출력 다듬기, 오류 모양, 띄운 때의 필드, 버전 폴더 사용권
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { argsOf, execWith, inUse, isJSON, leaseFor, type YtDlpFlags } from "../../src/sources/ytdlp-exec.ts";
import { _internals } from "../../src/infra/process-registry.ts";

// [무엇, 플래그, url, 최종 인자(플래그 뒤에 --, url. 빈 url 은 빠진다)]
const CASES: [string, Record<string, unknown>, string, unknown[]][] = [
  ["버전", { version: true }, "", ["--version", "--"]],
  [
    "정보 읽기",
    { dumpSingleJson: true, noPlaylist: true, format: "bestaudio/best", retries: 3, fragmentRetries: 3, ffmpegLocation: "C:\\ffmpeg bin\\ffmpeg.exe", extractorArgs: ["youtube:player_client=web_music,mweb", "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"], pluginDirs: "F:\\bot\\vendor\\bgutil", jsRuntimes: "node:C:\\node.exe", cookies: "C:\\a b\\cookies.txt" },
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ["--dump-single-json", "--no-playlist", "--format", "bestaudio/best", "--retries", "3", "--fragment-retries", "3", "--ffmpeg-location", "C:\\ffmpeg bin\\ffmpeg.exe", "--extractor-args", "youtube:player_client=web_music,mweb", "--extractor-args", "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416", "--plugin-dirs", "F:\\bot\\vendor\\bgutil", "--js-runtimes", "node:C:\\node.exe", "--cookies", "C:\\a b\\cookies.txt", "--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ],
  [
    "다운로드",
    { output: "C:\\cache\\%(id)s.%(ext)s", format: "251/bestaudio", extractAudio: true, audioFormat: "opus", postprocessorArgs: "ffmpeg:-b:a 128k", concurrentFragments: 4, writeInfoJson: true, maxFilesize: "500M", matchFilter: "!is_live", paths: "temp:C:\\tmp" },
    "https://soundcloud.com/a/b",
    ["--output", "C:\\cache\\%(id)s.%(ext)s", "--format", "251/bestaudio", "--extract-audio", "--audio-format", "opus", "--postprocessor-args", "ffmpeg:-b:a 128k", "--concurrent-fragments", "4", "--write-info-json", "--max-filesize", "500M", "--match-filter", "!is_live", "--paths", "temp:C:\\tmp", "--", "https://soundcloud.com/a/b"],
  ],
  ["재생목록", { flatPlaylist: true, dumpSingleJson: true, playlistItems: "1:50" }, "https://www.youtube.com/playlist?list=PL1", ["--flat-playlist", "--dump-single-json", "--playlist-items", "1:50", "--", "https://www.youtube.com/playlist?list=PL1"]],
  ["포맷 정렬과 받아 둔 정보", { formatSort: ["res:360"], loadInfoJson: "C:\\x.info.json", ignoreNoFormatsError: true, cookiesFromBrowser: "firefox" }, "", ["--format-sort", "res:360", "--load-info-json", "C:\\x.info.json", "--ignore-no-formats-error", "--cookies-from-browser", "firefox", "--"]],
  ["false 는 --no-이름", { noPlaylist: false, writeInfoJson: false }, "u", ["--no-no-playlist", "--no-write-info-json", "--", "u"]],
  ["한 글자 키, 대문자 한 글자 키, 한 글자 false", { f: "best", F: true, x: false }, "u", ["-f", "best", "--f", "--no-x", "--", "u"]],
  ["빈 문자열, 0, 음수, NaN", { format: "", retries: 0, fragmentRetries: -1, concurrentFragments: NaN }, "u", ["--format", "--retries", "0", "--fragment-retries", "-1", "--", "u"]],
  ["undefined, null, 객체는 버린다", { cookies: undefined, output: null, postprocessorArgs: { ffmpeg: "-b:a 128k" } }, "u", ["--", "u"]],
  ["배열의 원소: truthy 만 값으로, 바꾸지 않는다", { extractorArgs: ["a", "", 0, false, null, 1, true, "b"] }, "u", ["--extractor-args", "a", "--extractor-args", "--extractor-args", "--extractor-args", "--extractor-args", "--extractor-args", 1, "--extractor-args", true, "--extractor-args", "b", "--", "u"]],
  ["대문자가 여럿, 숫자가 든 키, 이미 - 가 든 키", { URLKey: "x", fooBar2Baz: "v", "kebab-key": "k", aB: true }, "u", ["---u-r-l-key", "x", "--foo-bar2-baz", "v", "--kebab-key", "k", "--a-b", "--", "u"]],
  ["값에 공백, 따옴표, = 가 있어도 하나의 인자", { matchFilter: "title ~= 'a b' & duration>60", extractorArgs: "youtube:x=1;y=2" }, "u", ["--match-filter", "title ~= 'a b' & duration>60", "--extractor-args", "youtube:x=1;y=2", "--", "u"]],
];

test("플래그를 인자로: youtube-dl-exec 가 내던 것과 같다", () => {
  for (const [label, flags, url, want] of CASES) assert.deepEqual([...argsOf(flags as YtDlpFlags), "--", url].filter(Boolean), want, label);
});

test("자체 업데이트 플래그(Windows onedir 판이 onefile 로 덮인다)와 dargs 의 특수 키는 받지 않는다", () => {
  for (const key of ["update", "updateTo", "U", "_", "--"]) assert.throws(() => argsOf({ [key]: true } as YtDlpFlags), new RegExp(key === "--" ? "--" : key));
});

test("isJSON 은 { 로 시작하는 출력만", () => {
  assert.equal(isJSON('{"id":"a"}'), true);
  assert.equal(isJSON("2026.11.04"), false);
  assert.equal(isJSON(""), false);
});

const node = execWith(process.execPath);
const NODE_DIR = path.dirname(process.execPath);
/** Node 로 코드를 돌린다(-e 와 --, url 없이) */
const script = (code: string, options = {}) => node("", { e: code } as YtDlpFlags, options);

test("성공: stdout, stderr 를 UTF-8 로 풀고 앞뒤 공백을 자른다", async () => {
  const out = await script('const n = String.fromCharCode(10); process.stdout.write("  한글 출력" + n + n); process.stderr.write(n + "경고" + n)');
  assert.deepEqual(out, { stdout: "한글 출력", stderr: "경고" });
});

test("실패: 종료 코드가 0 이 아니면 exitCode, stdout, stderr 를 실은 Error. 띄우기 실패는 그 오류 그대로", async () => {
  const failed = await script('console.log("out"); console.error("ERROR: 없음"); process.exit(3)').then(
    () => null,
    (error: { exitCode?: number; stdout?: string; stderr?: string }) => error,
  );
  assert.ok(failed instanceof Error);
  assert.deepEqual([failed.exitCode, failed.stdout, failed.stderr], [3, "out", "ERROR: 없음"]);
  await assert.rejects(execWith(path.join(NODE_DIR, "없는-yt-dlp"))("", {}), { code: "ENOENT" });
  assert.equal(inUse(NODE_DIR), false, "띄우지 못했으면 사용권을 바로 놓는다");
});

test("돌려주는 것은 띄운 때의 필드를 복사한다: 끝나도 exitCode 는 null 이라 레지스트리는 release 전까지 살아 있는 것으로 본다", async () => {
  const running = script("void 0");
  assert.equal(typeof running.pid, "number");
  assert.equal(running.spawnfile, process.execPath);
  await running;
  assert.equal(running.exitCode, null);
  assert.equal(_internals._isAlive(running), true);
});

test("버전 폴더 사용권: 중단으로 Promise 가 먼저 끝나도 프로세스가 끝날(exit) 때까지 잡혀 있다", async () => {
  const stop = new AbortController();
  const running = script("setTimeout(() => {}, 60000)", { signal: stop.signal });
  assert.equal(inUse(NODE_DIR), true);
  assert.equal(inUse(path.dirname(NODE_DIR)), true, "위 폴더로 물어도 그 아래의 사용권을 본다");
  stop.abort();
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(inUse(NODE_DIR), true, "AbortError 는 프로세스가 끝나기 전에 온다");
  for (let i = 0; i < 100 && inUse(NODE_DIR); i++) await new Promise((done) => setTimeout(done, 50));
  assert.equal(inUse(NODE_DIR), false);
});

test("사용권은 잡은 수만큼 놓아야 풀리고, 같은 것을 두 번 놓아도 한 번이다", () => {
  const dir = path.join(NODE_DIR, "가짜 버전");
  const one = leaseFor(path.join(dir, "yt-dlp"));
  const two = leaseFor(path.join(dir, "yt-dlp"));
  one();
  one();
  assert.equal(inUse(dir), true);
  two();
  assert.equal(inUse(dir), false);
  assert.equal(inUse(`${dir}x`), false, "이름이 앞부분만 같은 폴더는 다른 폴더다");
});
