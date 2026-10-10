// src/store/cookie-jar.ts · sources/youtube — 유튜브 쿠키. 비밀 표에 암호화해 두고 yt-dlp 를 돌릴 때만 그 실행의 파일로 푼다.
//
// 계약:
//  · 있는지는 물어볼 때마다 본다(대시보드로 갈아 끼우면 바로 반영). 빈 글은 없는 것이다
//  · 붙여넣은 내용을 그대로 둔다(탭 칸 · LF). 평상시에는 붙이지 않는다(연령 제한 폴백 전용)
//  · 실행마다 따로 파일. yt-dlp 가 고친 쿠키는 되담되, 그사이 새로 넣은 쿠키는 덮지 않는다. 파일은 끝나면 지운다

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { openTempStore } = await import("../helpers/temp-store.ts");
const cookieJar = await import("../../src/store/cookie-jar.ts");
const secrets = await import("../../src/store/secrets.ts");
const YouTube = await import("../../src/sources/youtube/index.ts");
const { _runOnce } = await import("../../src/sources/youtube/ytdlp-run.ts");
const config = (await import("../../src/config/index.ts")).default;
// 쿠키 출처는 운영 조절값이다(설정 탭). 이 시험은 file 로 둔다
Object.assign(config.ytdlp, { cookiesSource: "file", useCookieFile: true, cookiesFromBrowser: null });

const store = openTempStore("cookie-jar-");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cookie-files-"));
secrets._useKey(Buffer.alloc(32, 8).toString("base64"));
cookieJar._setDir(TMP);
after(() => {
  secrets._useKey();
  store.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});
beforeEach(() => cookieJar.save(""));

// 실제 확장이 내보내는 모양. 칸 구분은 탭이다
const SAMPLE = ["# Netscape HTTP Cookie File", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tSID\tabc123", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tHSID\tdef456"].join("\n");
const filesLeft = () => fs.readdirSync(TMP);

test("COOKIES_SOURCE=file 이면 브라우저가 아니라 넣은 쿠키를 쓴다", () => {
  assert.equal(config.ytdlp.useCookieFile, true);
  assert.equal(config.ytdlp.cookiesFromBrowser, null);
});

test("없거나 빈 글이면 쿠키가 없는 것이다", () => {
  assert.equal(cookieJar.ready(), false);
  assert.equal(YouTube.cookiesConfigured(), false, "없는 쿠키로 연령 제한 재시도를 돌리면 안 된다");
  assert.equal(YouTube.getYtDlpOptions({}, { forceCookies: true }).cookies, undefined);
  assert.equal(cookieJar.save("   \n"), false);
  assert.equal(cookieJar.ready(), false);
});

test("넣으면 봇을 다시 띄우지 않아도 그 다음 판정부터 반영된다. 평상시에는 붙이지 않는다", () => {
  cookieJar.save(SAMPLE);
  assert.equal(YouTube.cookiesConfigured(), true);
  assert.equal(YouTube.getYtDlpOptions({}, { forceCookies: true }).cookies, cookieJar.JAR);
  assert.equal(YouTube.getYtDlpOptions().cookies, undefined);
});

test("실행마다 파일로 풀어 넘기고 끝나면 지운다. 탭 칸 · LF · 끝 개행을 지킨다", async () => {
  cookieJar.save(SAMPLE.replace(/\n/g, "\r\n"));
  let seen = "";
  let given: unknown;
  await _runOnce("https://youtu.be/x", { cookies: cookieJar.JAR, dumpSingleJson: true }, null, async (_url, opts) => {
    given = opts?.cookies;
    seen = fs.readFileSync(String(opts?.cookies), "utf8");
    return {};
  });
  assert.ok(String(given).startsWith(TMP), "봇 전용 임시 폴더의 파일");
  assert.ok(!seen.includes("\r") && seen.endsWith("\n"));
  const rows = seen.split("\n").filter((one) => one && !one.startsWith("#"));
  for (const row of rows) assert.equal(row.split("\t").length, 7, "Netscape 형식은 7칸이다");
  assert.deepEqual(filesLeft(), [], "끝나면 지운다");
});

test("쿠키가 없으면 cookies 칸을 빼고 돌린다", async () => {
  let given: Record<string, unknown> = {};
  await _runOnce("https://youtu.be/x", { cookies: cookieJar.JAR }, null, async (_url, opts) => ((given = opts as Record<string, unknown>), {}));
  assert.equal("cookies" in given, false);
});

test("yt-dlp 가 고친 쿠키는 되담는다. 실패한 실행도 파일은 지운다", async () => {
  cookieJar.save(SAMPLE);
  const refreshed = `${SAMPLE}\n.youtube.com\tTRUE\t/\tTRUE\t1789974950\tSIDTS\tnew`;
  await assert.rejects(
    _runOnce("https://youtu.be/x", { cookies: cookieJar.JAR }, null, async (_url, opts) => {
      fs.writeFileSync(String(opts?.cookies), refreshed);
      throw new Error("yt-dlp 실패");
    }),
  );
  const held = cookieJar.checkout();
  assert.ok(held?.text.includes("SIDTS\tnew"));
  if (held) cookieJar.release(held);
  assert.deepEqual(filesLeft(), []);
});

test("돌던 중에 대시보드에서 새 쿠키를 넣었으면 되담지 않는다(새것을 옛것으로 덮지 않는다)", async () => {
  cookieJar.save(SAMPLE);
  await _runOnce("https://youtu.be/x", { cookies: cookieJar.JAR }, null, async (_url, opts) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    cookieJar.save(`${SAMPLE}\n# 새로 넣은 것`);
    fs.writeFileSync(String(opts?.cookies), `${SAMPLE}\n# yt-dlp 가 되쓴 옛것`);
    return {};
  });
  const held = cookieJar.checkout();
  assert.ok(held?.text.includes("# 새로 넣은 것"));
  if (held) cookieJar.release(held);
});

test("꺼지다 남은 쿠키 파일은 기동 때 치운다. 다른 파일은 건드리지 않는다", () => {
  fs.writeFileSync(path.join(TMP, "cookies-1-abc.txt"), "x");
  fs.writeFileSync(path.join(TMP, "other.txt"), "y");
  cookieJar.sweep();
  assert.deepEqual(filesLeft(), ["other.txt"]);
  fs.rmSync(path.join(TMP, "other.txt"));
});

test("상태 응답은 방식만 알리고 값 · 경로는 싣지 않는다", () => {
  cookieJar.save(SAMPLE);
  const snap = YouTube.statusSnapshot();
  assert.equal(snap.cookies, "file");
  assert.ok(!JSON.stringify(snap).includes("abc123"));
});

// 로그인 쿠키다. 같은 서버의 다른 사용자가 읽으면 안 된다(Windows 는 이 권한 비트를 쓰지 않는다)
test("푼 파일은 소유자만 읽고 쓴다", { skip: process.platform === "win32" }, () => {
  cookieJar.save(SAMPLE);
  const held = cookieJar.checkout();
  assert.ok(held);
  assert.equal(fs.statSync(held.file).mode & 0o777, 0o600);
  cookieJar.release(held);
});
