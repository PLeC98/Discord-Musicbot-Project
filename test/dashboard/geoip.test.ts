// src/dashboard/geoip.ts — IP 위치 DB 받기 · 확인 · 자동 · 읽기. 바깥(download.db-ip.com)에 닿지 않게 전송과 여는 것을 가짜로 넘긴다(작은 MMDB 를 만들 도구가 없다).

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as geoip from "../../src/dashboard/geoip.ts";
import config from "../../src/config/index.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-geoip-"));
const saved = { ...config.geoip };
after(() => {
  geoip._http.useFetch(null);
  geoip._use();
  Object.assign(config.geoip, saved);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const [thisMonth, lastMonth] = geoip.monthsNow();
// 올라와 있는 판 → 압축 전 내용
let published = new Map<string, string>();
const asked: string[] = [];
geoip._http.useFetch((async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const version = /dbip-city-lite-(\d{4}-\d{2})\.mmdb\.gz$/.exec(url)?.[1] ?? "";
  asked.push(`${init?.method ?? "GET"} ${version}`);
  const body = published.get(version);
  if (body === undefined) return new Response("not found", { status: 404 });
  const gz = gzipSync(Buffer.from(body));
  return new Response(init?.method === "HEAD" ? null : gz, { status: 200, headers: { "content-length": String(gz.length) } });
}) as typeof fetch);

// 가짜로 여는 것: 파일 내용이 "city" 로 시작하면 도시 DB. 레코드는 고정
let opened: string[] = [];
geoip._use({
  dir,
  opener: async (file) => {
    const text = fs.readFileSync(file, "utf8");
    opened.push(text);
    return {
      metadata: { databaseType: text.startsWith("city") ? "DBIP-City-Lite" : "DBIP-ASN-Lite" } as never,
      get: (ip: string) => (ip === "1.1.1.1" ? ({ city: { names: { en: "Sydney" } }, subdivisions: [{ names: { en: "New South Wales" } }], country: { names: { en: "Australia", ko: "오스트레일리아" } } } as never) : null),
    };
  },
});

beforeEach(() => {
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
  published = new Map();
  asked.length = 0;
  opened = [];
  Object.assign(config.geoip, { enabled: true, autoUpdate: true });
});

const files = () => fs.readdirSync(dir).sort();

test("확인: 이번 달 판이 있으면 그것, 없으면 지난달. 머리만 묻는다", async () => {
  published.set(lastMonth, "city-old");
  assert.deepEqual(await geoip.check(), { current: null, latest: lastMonth, size: gzipSync(Buffer.from("city-old")).length });
  assert.deepEqual(asked, [`HEAD ${thisMonth}`, `HEAD ${lastMonth}`]);
  published.set(thisMonth, "city-new");
  assert.equal((await geoip.check()).latest, thisMonth);
});

test("업데이트: 받아서 압축을 풀고 열어 본 뒤 옛 판을 지우고 바꿔 끼운다. 이미 그 판이면 받지 않는다", async () => {
  fs.writeFileSync(path.join(dir, `dbip-city-lite-${lastMonth}.mmdb`), "city-old");
  published.set(thisMonth, "city-new");
  assert.equal(await geoip.update(), thisMonth);
  assert.deepEqual(files(), [`dbip-city-lite-${thisMonth}.mmdb`]);
  assert.equal(fs.readFileSync(path.join(dir, files()[0]), "utf8"), "city-new");
  assert.equal(geoip.status().version, thisMonth);

  asked.length = 0;
  await geoip.update();
  assert.deepEqual(asked, [`HEAD ${thisMonth}`], "같은 판이면 받지 않는다");
});

test("받은 것이 도시 DB 가 아니거나 받다 실패하면 쓰던 판을 그대로 두고 까닭을 남긴다", async () => {
  fs.writeFileSync(path.join(dir, `dbip-city-lite-${lastMonth}.mmdb`), "city-old");
  published.set(thisMonth, "asn-wrong");
  await assert.rejects(geoip.update());
  assert.deepEqual(files(), [`dbip-city-lite-${lastMonth}.mmdb`], "임시 파일도 남지 않는다");
  assert.match(geoip.status().error ?? "", /도시 DB 가 아닙니다/);
});

test("자동: 켜져 있고 가진 판이 이번 달이 아니면 이번 달 판을 받는다. 아직 없으면 받지 않고(내일 다시), 파일이 아예 없으면 지난달 판이라도", async () => {
  published.set(lastMonth, "city-old");
  await geoip.autoCheck();
  assert.deepEqual(files(), [`dbip-city-lite-${lastMonth}.mmdb`], "처음이면 지난달 판");

  asked.length = 0;
  await geoip.autoCheck();
  assert.deepEqual(asked, [`HEAD ${thisMonth}`], "이번 달 판이 없으면 묻기만");

  published.set(thisMonth, "city-new");
  await geoip.autoCheck();
  assert.deepEqual(files(), [`dbip-city-lite-${thisMonth}.mmdb`]);

  asked.length = 0;
  await geoip.autoCheck();
  assert.deepEqual(asked, [], "이번 달 판이 있으면 묻지도 않는다");
});

test("자동 업데이트를 껐거나 위치 DB 를 껐으면 묻지 않는다", async () => {
  published.set(thisMonth, "city-new");
  config.geoip.autoUpdate = false;
  await geoip.autoCheck();
  config.geoip.autoUpdate = true;
  config.geoip.enabled = false;
  await geoip.autoCheck();
  assert.deepEqual([asked, files()], [[], []]);
});

test("읽기: 켜져 있고 파일이 있을 때만 올린다. 이름은 한국어가 있으면 한국어, 모르는 주소는 null. 끄면 올리지 않는다(파일은 둔다)", async () => {
  assert.equal(await geoip.load(), false, "파일이 없다");
  fs.writeFileSync(path.join(dir, `dbip-city-lite-${thisMonth}.mmdb`), "city-new");
  assert.equal(await geoip.load(), true);
  assert.deepEqual(geoip.locate("1.1.1.1"), { kind: "geo", city: "Sydney", region: "New South Wales", country: "오스트레일리아" });
  assert.equal(geoip.locate("8.8.8.8"), null);
  await geoip.load();
  assert.equal(opened.length, 1, "이미 올렸으면 다시 열지 않는다");

  config.geoip.enabled = false;
  assert.equal(await geoip.load(), false);
  assert.equal(geoip.locate("1.1.1.1"), null);
  assert.deepEqual(files(), [`dbip-city-lite-${thisMonth}.mmdb`]);
});
