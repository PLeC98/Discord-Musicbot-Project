// src/dashboard/login-background/youtube.ts — 유튜브는 다운로드 대행: 다운로드 단계는 편집 창용 480p, 고해상도 다운로드 단계는 짧은 변 2160 이하의 가장 좋은 영상.
// yt-dlp 는 실행하는 exec 만 가짜로 둔다(출력 템플릿대로 영상 · 정보 파일을 쓴다). 영상은 실제 ffmpeg 로 만든 표본(없으면 건너뛴다)

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { runFfmpeg } from "../../src/media/ffmpeg/job.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { useExec, type Exec, type YtDlpFlags } from "../../src/sources/ytdlp-spawn.ts";
import * as store from "../../src/dashboard/login-background/store.ts";
import { bestSize, highRes, receiveYoutube } from "../../src/dashboard/login-background/youtube.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-youtube-"));
const SAMPLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-yt-sample-")), "clip.mp4");
after(() => {
  useExec(null);
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(path.dirname(SAMPLE), { recursive: true, force: true, maxRetries: 5 });
});
const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN ? false : "ffmpeg 바이너리 없음" };
const signal = new AbortController().signal;
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** yt-dlp 가 다운로드한 것처럼: 출력 템플릿의 %(ext)s 를 mp4 로 영상 · 정보 파일을 쓴다. fail 이면 실패, skip 이면 아무것도 쓰지 않는다(라이브 건너뜀) */
let reply: { fail?: string; skip?: boolean; info?: object } = {};
const calls: YtDlpFlags[] = [];

before(async () => {
  if (BIN) await runFfmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "2", "-c:v", "mpeg4", SAMPLE]);
  useExec(((_url: string, flags: YtDlpFlags = {}) => {
    calls.push(flags);
    if (reply.fail) return Promise.reject(Object.assign(new Error("exit 1"), { stderr: reply.fail }));
    if (!reply.skip) {
      const base = String(flags.output).replace("%(ext)s", "");
      fs.copyFileSync(SAMPLE, `${base}mp4`);
      fs.writeFileSync(`${base}info.json`, JSON.stringify(reply.info ?? {}));
    }
    return Promise.resolve({ stdout: "", stderr: "" });
  }) as unknown as Exec);
});

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  store._useDir(DIR);
  reply = {};
  calls.length = 0;
});

const job = (one: store.Stored) => ({ item: one, folder: store.folderOf(one.id), signal, progress: () => {} });
const youtubeItem = () => store.create({ kind: "video", from: "youtube", name: URL, link: URL });

test("다운로드: 480p 를 원본 경로에 다운로드하고, 크기는 고해상도로 다운로드할 크기(짧은 변 4K 이하에서 가장 큰 것)", opts, async () => {
  reply = {
    info: {
      formats: [
        { width: 1280, height: 720, vcodec: "avc1" },
        { width: 3840, height: 2160, vcodec: "vp9" },
        { width: 7680, height: 4320, vcodec: "av01" },
        { width: null, height: null, vcodec: "none" },
      ],
    },
  };
  const one = youtubeItem();
  const result = await receiveYoutube(job(one));
  assert.deepEqual([result.kind, result.width, result.height], ["video", 3840, 2160]);
  assert.ok(Math.abs(result.duration! - 2) < 0.2);
  assert.ok(fs.existsSync(store.sourceOf(one.id)));
  assert.deepEqual(fs.readdirSync(store.folderOf(one.id)).sort(), ["source"]);
  const flags = calls[0];
  assert.deepEqual([flags.format, flags.formatSort, flags.noPlaylist, flags.matchFilter, flags.writeInfoJson], ["bv*", ["res:480"], true, "!is_live", true]);
  assert.ok(Number(flags.maxFilesize) > 0);
});

test("고해상도 다운로드: 짧은 변 2160 이하의 가장 좋은 영상으로 원본을 바꾸고 실제 크기를 적는다", opts, async () => {
  const one = youtubeItem();
  fs.writeFileSync(store.sourceOf(one.id), "480p 자리");
  const result = await highRes(job(one));
  assert.deepEqual([result.width, result.height], [640, 360]);
  assert.deepEqual(calls[0].formatSort, ["res:2160"]);
  assert.notEqual(fs.readFileSync(store.sourceOf(one.id), "utf8").slice(0, 6), "480p 자리");
});

test("다운로드하지 못하면 background-link-failed(실패 · 라이브라 건너뜀)", async () => {
  for (const one of [{ fail: "ERROR: Video unavailable" }, { skip: true }]) {
    reply = one;
    const error = await receiveYoutube(job(youtubeItem())).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.equal(codeOf(error), "background-link-failed", JSON.stringify(one));
  }
});

test("고해상도 크기: 세로 영상은 짧은 변(폭)으로 선택한다", () => {
  assert.deepEqual(
    bestSize({
      formats: [
        { width: 1080, height: 1920, vcodec: "vp9" },
        { width: 2160, height: 3840, vcodec: "vp9" },
        { width: 4320, height: 7680, vcodec: "av01" },
      ],
    }),
    { width: 2160, height: 3840 },
  );
  assert.equal(bestSize({}), null);
});
