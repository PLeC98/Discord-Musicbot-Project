// src/dashboard/routes/app-emojis.ts, app-emoji-glyphs.ts: 앱 이모지 목록(입력란 문자), 이미지, 그림 글꼴.
// 이미지는 캐시 폴더에 미리 둬 CDN 에 가지 않는다

import fs from "node:fs";
import path from "node:path";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import sharp from "sharp";
import * as fontkit from "fontkit";
import { fake } from "../helpers/fake.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { appEmojisRouter } from "../../src/dashboard/routes/app-emojis.ts";
import { _useDir } from "../../src/dashboard/app-emoji-glyphs.ts";
import { useAppEmojis } from "../../src/store/app-emoji-book.ts";
import type { AppEmojiList } from "../../src/dashboard/contract/app-emojis.ts";

const store = openTempStore("app-emojis-");
const cache = path.join(store.dir, "app-emojis");
_useDir(cache);

const PARTY = { id: "111111111111111111", name: "party", animated: false };
const PAUSE = { id: "222222222222222222", name: "pause", animated: false };

const app = express();
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.get("x-test-anon") !== "1") Object.assign(req, { session: fake<Request["session"]>({ user: { id: "u1", username: "u1" }, loginAt: Date.now() }) });
  else Object.assign(req, { session: fake<Request["session"]>({}) });
  next();
});
app.use("/api/app-emojis", appEmojisRouter);
let base = "";
let server: Awaited<ReturnType<typeof listenForFetch>>;

before(async () => {
  fs.mkdirSync(cache, { recursive: true });
  for (const one of [PARTY, PAUSE])
    fs.writeFileSync(
      path.join(cache, `${one.id}.png`),
      await sharp({ create: { width: 128, height: 128, channels: 4, background: "#5865f2" } })
        .png()
        .toBuffer(),
    );
  useAppEmojis([PARTY, PAUSE]);
  server = await listenForFetch(app);
  base = `${baseUrl(server)}/api/app-emojis`;
});
after(() => {
  server.close();
  useAppEmojis([]);
  store.close();
});

const list = async () => (await (await fetch(base)).json()) as AppEmojiList;

test("로그인하지 않으면 읽지 못한다", async () => {
  assert.equal((await fetch(base, { headers: { "x-test-anon": "1" } })).status, 401);
  assert.equal((await fetch(`${base}/${PARTY.id}.png`, { headers: { "x-test-anon": "1" } })).status, 401);
});

test("목록: 이모지마다 보조 사용자 정의 영역 문자, 아이콘인지. 문자는 다시 불러도 같다", async () => {
  const first = await list();
  const party = first.emojis.find((one) => one.id === PARTY.id)!;
  const pause = first.emojis.find((one) => one.id === PAUSE.id)!;
  assert.equal(party.icon, false);
  assert.equal(pause.icon, true);
  for (const one of [party, pause]) assert.ok(one.char.codePointAt(0)! >= 0xf0000 && one.char.codePointAt(0)! <= 0xffffd, one.char);
  assert.notEqual(party.char, pause.char);
  assert.deepEqual((await list()).emojis, first.emojis);
});

test("아이콘은 다시 올려 id 가 바뀌어도 같은 문자, 판은 바뀐다", async () => {
  const before = await list();
  useAppEmojis([PARTY, { ...PAUSE, id: "333333333333333333" }]);
  try {
    const now = await list();
    assert.equal(now.emojis.find((one) => one.name === "pause")!.char, before.emojis.find((one) => one.name === "pause")!.char);
    assert.notEqual(now.fontVersion, before.fontVersion);
  } finally {
    useAppEmojis([PARTY, PAUSE]);
  }
});

test("이미지: 앱 목록에 있는 id 만, 확장자도 맞아야. id 주소로 오래 캐시", async () => {
  const ok = await fetch(`${base}/${PARTY.id}.png`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control") ?? "", /immutable/);
  assert.equal((await fetch(`${base}/999999999999999999.png`)).status, 404, "앱에 없는 id 를 받아 오지 않는다");
  assert.equal((await fetch(`${base}/${PARTY.id}.gif`)).status, 404);
  assert.equal((await fetch(`${base}/party.png`)).status, 404);
});

test("글꼴: 목록의 문자를 모두 담고, ETag 로 다시 확인한다", async () => {
  const { emojis } = await list();
  for (const format of ["sbix", "svg"]) {
    const res = await fetch(`${base}/font.${format}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    const font = fontkit.create(Buffer.from(await res.arrayBuffer())) as fontkit.Font;
    assert.deepEqual(font.characterSet.sort(), emojis.map((one) => one.char.codePointAt(0)!).sort());
    const again = await fetch(`${base}/font.${format}`, { headers: { "If-None-Match": res.headers.get("etag")! } });
    assert.equal(again.status, 304);
  }
  assert.equal((await fetch(`${base}/font.ttf`)).status, 404);
});
