// src/store/snapshots.ts: settings.db 스냅샷. 하루 한 번, 불러오기, 복원 전에 뜨고, 선택한 것을 다음 기동에 교체한다

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

test("뜬 스냅샷은 그때의 settings.db 다(뒤에 바꾼 것은 들어가지 않는다)", async () => {
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

test("매일 것은 하루에 하나, 7개, 불러오기, 복원, 초기화 전 것은 합쳐 5개까지 남긴다", async () => {
  for (let day = 1; day <= 9; day++) await snapshots.take("daily", new Date(2026, 9, day));
  for (let n = 0; n < 4; n++) await snapshots.take("before-import", new Date(2026, 9, 11, 8, 0, n));
  for (let n = 4; n < 7; n++) await snapshots.take("before-reset", new Date(2026, 9, 11, 8, 0, n));
  const rows = snapshots.list();
  assert.equal(rows.filter((one) => one.kind === "before-reset").length, 3, "초기화 전 것도 목록에 든다");
  assert.equal(rows.filter((one) => one.kind === "daily").length, snapshots.KEEP_DAILY);
  assert.equal(rows.filter((one) => one.kind !== "daily").length, snapshots.KEEP_OTHERS);
  assert.ok(!rows.some((one) => one.name === "settings-daily-2026-10-01.db"), "오래된 것부터 지운다");

  const before = snapshots.list().length;
  assert.equal(await snapshots.ensureDaily(new Date(2026, 9, 9, 23)), null, "오늘 것이 있으면 뜨지 않는다");
  assert.equal(snapshots.list().length, before);
});

test("복원: 예약하면 다음 기동이 열기 전에 교체하고, 바꾸기 전 것은 스냅샷으로 남긴다", async () => {
  settingsDocs.write("status", { messages: ["복원할 것"] }, 0);
  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  settingsDocs.write("status", { messages: ["지금 것"] }, 1);

  snapshots.stage(name);
  assert.equal(snapshots.staged(), name);
  assert.deepEqual(read("status"), { messages: ["지금 것"] }, "예약만 한다");

  stores.close();
  assert.equal(snapshots.applyStaged(store.dir), name);
  assert.equal(snapshots.applyStaged(store.dir), null, "한 번만");
  stores.open(store.dir);
  assert.deepEqual(read("status"), { messages: ["복원할 것"] });
  const kept = snapshots.list().find((one) => one.kind === "before-restore");
  assert.ok(kept, "바꾸기 전 것");
  const db = new Database(path.join(backups, kept.name), { readonly: true });
  try {
    assert.match((db.prepare("SELECT data_json FROM documents WHERE name = 'status'").get() as { data_json: string }).data_json, /지금 것/);
  } finally {
    db.close();
  }
});

test("예약을 취소하면 교체하지 않는다", async () => {
  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  snapshots.stage(name);
  snapshots.unstage();
  assert.equal(snapshots.staged(), null);
  stores.close();
  assert.equal(snapshots.applyStaged(store.dir), null);
  stores.open(store.dir);
});

test("없는 이름, 폴더 밖 이름, 구조 버전이 다른 스냅샷은 예약하지 않는다", async () => {
  assert.ok(failsWith("SNAPSHOT_NOT_FOUND", () => snapshots.stage("settings-daily-1999-01-01.db")));
  assert.ok(failsWith("SNAPSHOT_NOT_FOUND", () => snapshots.stage("../settings.db")));

  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  const db = new Database(path.join(backups, name));
  db.pragma("user_version = 99");
  db.close();
  assert.ok(failsWith("SNAPSHOT_MISMATCH", () => snapshots.stage(name)));
  assert.equal(snapshots.staged(), null);
});

test("같은 초에 두 번 떠도 앞 복원점을 덮지 않는다(꼬리 -2), 꼬리가 붙은 것도 예약할 수 있다", async () => {
  const at = new Date(2026, 9, 11, 9, 0, 0);
  settingsDocs.write("status", { messages: ["첫째"] }, 0);
  const first = await snapshots.take("before-import", at);
  settingsDocs.write("status", { messages: ["둘째"] }, 1);
  const [second, third] = await Promise.all([snapshots.take("before-import", at), snapshots.take("before-reset", at)]);
  assert.deepEqual([first, second, third], ["settings-before-import-2026-10-11-090000.db", "settings-before-import-2026-10-11-090000-2.db", "settings-before-reset-2026-10-11-090000.db"]);
  assert.equal(snapshots.list().length, 3);
  assert.deepEqual(
    fs.readdirSync(backups).filter((name) => !name.endsWith(".db")),
    [],
    "뜨던 파일(.part)이 남지 않는다",
  );
  snapshots.stage(second);
  assert.equal(snapshots.staged(), second);
});

// 다른 프로그램이 앞 시점을 읽고 있으면 -wal 을 본체에 다 접지 못한다(Windows 는 열린 파일을 지우지 못해 교체가 RESTORE_FAILED 로 멈추므로 거기까지 가지 않는다)
test("뜨다 멈춰 남은 .part 는 한 시간이 지나면 지우고, 뜨는 중일 수 있는 새 것은 둔다", async () => {
  fs.mkdirSync(backups, { recursive: true });
  const stale = path.join(backups, "settings-before-import-2026-11-01-000000.db.part");
  const fresh = path.join(backups, "settings-before-import-2026-11-06-000000.db.part");
  fs.writeFileSync(stale, "반쯤");
  fs.writeFileSync(fresh, "뜨는 중");
  const old = new Date(Date.now() - snapshots.STALE_PART_MS - 60_000);
  fs.utimesSync(stale, old, old);
  await snapshots.take("before-import");
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true);
});

test("복원 전 사본: 다른 읽는 쪽이 있어 -wal 을 접지 못해도 -wal 에만 있는 내용까지 남긴다", { skip: process.platform === "win32" ? "Windows 는 열린 settings.db 를 지우지 못한다" : false }, async () => {
  const name = await snapshots.take("daily", new Date(2026, 9, 12));
  snapshots.stage(name);
  stores.close();
  const file = path.join(store.dir, "settings.db");
  const reader = new Database(file);
  const writer = new Database(file);
  try {
    writer.pragma("wal_autocheckpoint = 0");
    reader.prepare("BEGIN").run();
    reader.prepare("SELECT COUNT(*) FROM documents").get();
    writer.prepare("INSERT INTO documents (name, data_json, revision) VALUES ('wal-only', '{}', 0)").run();
    writer.close();
    assert.equal(snapshots.applyStaged(store.dir), name);
  } finally {
    if (reader.inTransaction) reader.prepare("ROLLBACK").run();
    reader.close();
    stores.open(store.dir);
  }
  const kept = snapshots.list().find((one) => one.kind === "before-restore")!;
  const db = new Database(path.join(backups, kept.name), { readonly: true });
  try {
    assert.ok(db.prepare("SELECT 1 FROM documents WHERE name = 'wal-only'").get(), "-wal 에만 있던 행");
  } finally {
    db.close();
  }
});
