// @ts-nocheck sources/youtube 가 아직 JS 라 YouTube 의 메서드 타입이 없다. 10단계 sources 폴더에서 뗀다
// 유튜브 쿠키. COOKIES_SOURCE 한 칸이 방식을 정하고, 파일 방식이면 config/cookies.txt 를 쓴다.
//
// 계약 셋:
//  · 파일 존재 판정은 기동 시점이 아니라 물어볼 때마다 한다(대시보드로 갈아 끼우면 바로 반영)
//  · 빈 파일은 없는 것으로 친다(연령 제한 재시도를 빈 파일로 낭비하지 않게)
//  · 저장은 붙여넣은 내용을 그대로 둔다. 탭으로 나뉜 칸이 살아 있어야 yt-dlp 가 읽는다
//
// dotenv 는 기설정 process.env 를 덮지 않으므로 require 전에 세팅한 값이 .env 보다 우선.

process.env.COOKIES_SOURCE = "file";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const yamlStore = await import("../../src/config/yamlStore.ts");
const cookieConfig = await import("../../src/config/cookies.ts");
const YouTube = await import("../../src/sources/youtube/index.ts");
const config = (await import("../../config.ts")).default;

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cookies-"));

before(() => yamlStore._setConfigDir(DIR));
after(() => {
  yamlStore._setConfigDir(path.join(import.meta.dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});
beforeEach(() => cookieConfig.clearCookies());

// 실제 확장이 내보내는 모양. 칸 구분은 탭이다
const SAMPLE = ["# Netscape HTTP Cookie File", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tSID\tabc123", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tHSID\tdef456"].join("\n");

test("COOKIES_SOURCE=file 이면 브라우저가 아니라 파일 방식이다", () => {
  assert.equal(config.ytdlp.useCookieFile, true);
  assert.equal(config.ytdlp.cookiesFromBrowser, null);
});

test("파일이 없으면 쿠키가 없는 것이다", () => {
  assert.equal(cookieConfig.cookiesReady(), false);
  assert.equal(YouTube.cookiesConfigured(), false, "없는 파일로 연령 제한 재시도를 돌리면 안 된다");
  assert.equal(YouTube.getYtDlpOptions({}, { forceCookies: true }).cookies, undefined);
});

test("빈 파일도 없는 것으로 친다", () => {
  fs.writeFileSync(cookieConfig.cookiesPath(), "   \n");
  assert.equal(cookieConfig.cookiesReady(), false, "공백뿐인 파일은 yt-dlp 에 넘겨도 소용이 없다");
});

test("저장하면 봇을 다시 띄우지 않아도 그 다음 판정부터 반영된다", () => {
  assert.equal(YouTube.cookiesConfigured(), false);
  cookieConfig.saveCookies(SAMPLE);
  assert.equal(YouTube.cookiesConfigured(), true);
  assert.equal(YouTube.getYtDlpOptions({}, { forceCookies: true }).cookies, cookieConfig.cookiesPath());
});

test("평상시에는 쿠키를 붙이지 않는다 (연령 제한 폴백 전용)", () => {
  cookieConfig.saveCookies(SAMPLE);
  assert.equal(YouTube.getYtDlpOptions().cookies, undefined);
});

test("탭으로 나뉜 칸이 그대로 남는다", () => {
  cookieConfig.saveCookies(SAMPLE);
  const saved = fs.readFileSync(cookieConfig.cookiesPath(), "utf8");
  const rows = saved.split("\n").filter((one) => one && !one.startsWith("#"));
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.split("\t").length, 7, "Netscape 형식은 7칸이다");
});

test("CRLF 로 붙여넣어도 LF 로 맞추고 끝에 개행을 둔다", () => {
  cookieConfig.saveCookies(SAMPLE.replace(/\n/g, "\r\n"));
  const saved = fs.readFileSync(cookieConfig.cookiesPath(), "utf8");
  assert.ok(!saved.includes("\r"), "yt-dlp 가 마지막 칸에 \\r 을 붙여 읽으면 안 된다");
  assert.ok(saved.endsWith("\n"));
});

test("빈 글을 저장하면 파일을 지운다 (빈 파일을 남기지 않는다)", () => {
  cookieConfig.saveCookies(SAMPLE);
  assert.equal(cookieConfig.saveCookies("   "), false);
  assert.equal(fs.existsSync(cookieConfig.cookiesPath()), false);
});

test("쿠키를 쥔 yt-dlp 수를 센다 (덮어쓰기 경고의 근거)", () => {
  assert.equal(YouTube.cookieRunsInFlight(), 0, "아무것도 안 도는데 경고가 뜨면 안 된다");
});

test("상태 응답은 방식만 알리고 경로는 싣지 않는다", () => {
  cookieConfig.saveCookies(SAMPLE);
  const snap = YouTube.statusSnapshot();
  assert.equal(snap.cookies, "file");
  assert.ok(!JSON.stringify(snap).includes(cookieConfig.cookiesPath()));
});
