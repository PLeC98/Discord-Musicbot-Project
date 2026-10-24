// src/dashboard/reset.ts — 봇 설정 · 서버별 설정 · 디스플레이 초기화. 설정이 바뀌는 줄은 바꾸기 전에 before-reset 스냅샷을 남기고,
// 지운 뒤 메모리(설정 객체 · 서버별 설정의 캐시 · 바깥 서비스 키)를 DB 에 맞춘다. 기본값을 써 넣지 않고 행을 지운다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { openTempStore, setGuild } from "../helpers/temp-store.ts";

const store = openTempStore("reset-");
const secrets = await import("../../src/store/secrets.ts");
secrets._useKey(Buffer.alloc(32, 7).toString("base64"));
const reset = await import("../../src/dashboard/reset.ts");
const snapshots = await import("../../src/store/snapshots.ts");
const settingsDocs = await import("../../src/store/settings-docs.ts");
const tunables = await import("../../src/store/tunables.ts");
const serviceKeys = await import("../../src/store/service-keys.ts");
const guildSettings = await import("../../src/store/guild-settings.ts");
const appearance = await import("../../src/dashboard/appearance.ts");
const backgrounds = await import("../../src/dashboard/login-background/store.ts");
const { LOGIN_BG_LIMITS_DEFAULT, LOGIN_BG_OPTIONS_DEFAULT } = await import("../../src/dashboard/contract/login-background.ts");
const { default: config } = await import("../../src/config/index.ts");

const DISPLAY = fs.mkdtempSync(path.join(os.tmpdir(), "reset-display-"));
appearance._useDir(path.join(DISPLAY, "favicon"));
backgrounds._useDir(path.join(DISPLAY, "login-background"));
after(() => {
  secrets._useKey();
  store.close();
  fs.rmSync(DISPLAY, { recursive: true, force: true, maxRetries: 5 });
});

test("봇 설정: 설정 문서와 비밀값을 지우고 다시 읽는다. 기동 때와 달라진 다시 시작 값이 있으면 restart", async () => {
  // 기동 때 BGUTIL_ENABLED=true 였다(다시 시작해야 적용되는 값)
  tunables.writeRaw({ BGUTIL_ENABLED: "true", RATE_LIMIT_API_MAX: "7" });
  tunables.load();
  settingsDocs.write("genres", { genres: [] }, settingsDocs.read("genres").revision);
  serviceKeys.save("lastfm", { apiKey: "lastfm-key-1234567890" });
  assert.deepEqual([config.dashboard.rateLimit.apiMax, config.sources.lastfmKey, secrets.count()], [7, "lastfm-key-1234567890", 1]);

  const done = await reset.resetBotSettings("tester");

  assert.match(done.snapshot, /^settings-before-reset-/);
  assert.ok(snapshots.list().some((one) => one.name === done.snapshot && one.kind === "before-reset"));
  assert.equal(done.restart, true, "기동 때 true 였던 BGUTIL_ENABLED 가 기본값(false)이 된다");
  assert.deepEqual(settingsDocs.names(), [], "기본값을 써 넣지 않는다");
  assert.equal(secrets.count(), 0);
  assert.equal(config.dashboard.rateLimit.apiMax, 120, "운영 조절값은 바로 기본값");
  assert.equal(config.sources.lastfmKey, null, "바깥 서비스 키도 메모리에서 빠진다");

  tunables.load();
  assert.equal((await reset.resetBotSettings("tester")).restart, false, "기동 때와 같으면 다시 시작하지 않아도 된다");
});

test("서버별 설정: 모든 서버를 지우고 읽어 둔 것도 버린다", async () => {
  setGuild("g1", { botChannel: "c1" });
  setGuild("g2", { djRoles: ["r1"] });
  assert.equal(await guildSettings.getBotChannel("g1"), "c1", "읽어 둔다");

  const done = await reset.resetGuildSettings("tester");

  assert.equal(done.guilds, 2);
  assert.match(done.snapshot, /^settings-before-reset-/);
  assert.equal(guildSettings.guildCount(), 0);
  assert.equal(await guildSettings.getBotChannel("g1"), null);
  assert.deepEqual(await guildSettings.getDjRoles("g2"), []);
});

test("디스플레이: 파비콘 그림과 로그인 배경(기록 · 화면 값 · 한도)을 비운다", async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
    .png()
    .toBuffer();
  assert.equal((await appearance.addFavicon(32, png)).ok, true);
  assert.equal((await appearance.addFavicon(32, png)).ok, true);
  backgrounds.create({ kind: "image", from: "upload", name: "배경" });
  backgrounds.replace({ ...backgrounds.loaded(), options: { ...LOGIN_BG_OPTIONS_DEFAULT, follow: !LOGIN_BG_OPTIONS_DEFAULT.follow }, limits: { history: 1, maxBytes: 1 } });
  assert.deepEqual([appearance.faviconCount(), backgrounds.items().length], [2, 1]);

  const done = reset.resetDisplay("tester");

  assert.deepEqual(done, { favicons: 2, backgrounds: 1 });
  assert.equal(appearance.faviconCount(), 0);
  assert.deepEqual(
    fs.readdirSync(path.join(DISPLAY, "favicon")).filter((name) => name.endsWith(".png")),
    [],
    "그림 파일도 지운다",
  );
  const left = backgrounds.loaded();
  assert.deepEqual([left.current, left.items, left.options, left.limits], [null, [], LOGIN_BG_OPTIONS_DEFAULT, LOGIN_BG_LIMITS_DEFAULT]);
});
