// src/store/snapshots.ts — settings.db 스냅숏. 하루 한 번 · 가져오기 · 되살리기 전에 뜨고, 고른 것을 다음 기동에 바꿔 끼운다

import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { openTempStore } from "../helpers/temp-store.ts";
import * as stores from "../../src/store/stores.ts";
import * as snapshots from "../../src/store/snapshots.ts";
import * as settingsDocs from "../../src/store/settings-docs.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

const store = openTempStore("snapshots-");
const backups = path.join(store.dir, "backups");
const read = (name: string) => settingsDocs.read(name).data;
const failsWith = (code: string, fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return codeOf(error) === code;
  }
  return false;
};

beforeEach(() => {
  fs.rmSync(backups, { recursive: true, force: true });
  snapshots.unstage();
  store.settings().exec("DELETE FROM documents");
});
after(() => {
  snapshots.stopDaily();
  store.close();
});

test("뜬 스냅숏은 그때의 settings.db 다(뒤에 바꾼 것은 들어가지 않는다)", async () => {
  settingsDocs.write("status", { messages: ["그때"] }, 0);
  const name = await snapshots.take("before-import", new Date(2026, 9, 11, 7, 30, 5));
  assert.equal(name, "settings-before-import-2026-10-11-073005.db");
  settingsDocs.write("status", { messages: ["지금"] }, 1);

  const db = new Database(path.join(backups, name), { readonly: true });
  try {
    assert.deepEqual(JSON.parse((db.prepare("SELECT data_json FROM documents WHERE name = 'status'").get() as { data_json: string }).data_json), { messages: ["그때"] });
  } finally {
    db.close();
  }
});

test("매일 것은 하루에 하나 · 7개, 가져오기 · 되살리기 전 것은 합쳐 5개까지 남긴다", async () => {
  for (let day = 1; day <= 9; day++) await snapshots.take("daily", new Date(2026, 9, day));
  for (let n = 0; n < 7; n++) await snapshots.take("before-import", new Date(2026, 9, 11, 8, 0, n));
  const rows = snapshots.list();
  assert.equal(rows.filter((one) => one.kind === "daily").length, snapshots.KEEP_DAILY);
  assert.equal(rows.filter((one) => one.kind !== "daily").length, snapshots.KEEP_OTHERS);
  assert.ok(!rows.some((one) => one.name === "settings-daily-2026-10-01.db"), "오래된 것부터 지운다");

  const before = snapshots.list().length;
  assert.equal(await snapshots.ensureDaily(new Date(2026, 9, 9, 23)), null, "오늘 것이 있으면 뜨지 않는다");
  assert.equal(snapshots.list().length, before);
});

test("되살리기: 걸어 두면 다음 기동이 열기 전에 바꿔 끼우고, 바꾸기 전 것은 스냅숏으로 남긴다", async () => {
  settingsDocs.write("status", { messages: ["되살릴 것"] }, 0);
  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  settingsDocs.write("status", { messages: ["지금 것"] }, 1);

  snapshots.stage(name);
  assert.equal(snapshots.staged(), name);
  assert.deepEqual(read("status"), { messages: ["지금 것"] }, "걸어 두기만 한다");

  stores.close();
  assert.equal(snapshots.applyStaged(store.dir), name);
  assert.equal(snapshots.applyStaged(store.dir), null, "한 번만");
  stores.open(store.dir);
  assert.deepEqual(read("status"), { messages: ["되살릴 것"] });
  const kept = snapshots.list().find((one) => one.kind === "before-restore");
  assert.ok(kept, "바꾸기 전 것");
  const db = new Database(path.join(backups, kept.name), { readonly: true });
  try {
    assert.match((db.prepare("SELECT data_json FROM documents WHERE name = 'status'").get() as { data_json: string }).data_json, /지금 것/);
  } finally {
    db.close();
  }
});

test("거두면 바꿔 끼우지 않는다", async () => {
  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  snapshots.stage(name);
  snapshots.unstage();
  assert.equal(snapshots.staged(), null);
  stores.close();
  assert.equal(snapshots.applyStaged(store.dir), null);
  stores.open(store.dir);
});

test("없는 이름 · 폴더 밖 이름 · 구조 버전이 다른 스냅숏은 걸지 않는다", async () => {
  assert.ok(failsWith("SNAPSHOT_NOT_FOUND", () => snapshots.stage("settings-daily-1999-01-01.db")));
  assert.ok(failsWith("SNAPSHOT_NOT_FOUND", () => snapshots.stage("../settings.db")));

  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  const db = new Database(path.join(backups, name));
  db.pragma("user_version = 99");
  db.close();
  assert.ok(failsWith("SNAPSHOT_MISMATCH", () => snapshots.stage(name)));
  assert.equal(snapshots.staged(), null);
});
