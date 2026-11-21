// src/store/user-settings.ts, users-db.ts: 사람별 설정(개인 언어). 셋 중 하나(정한 적 없음, 직접 고른 자동, 언어), 필드가 모두 비면 행을 지운다,
// 틀린 값은 정하지 않은 것으로 읽는다, 구조 버전이 맞지 않으면 열지 않는다. 서버 언어는 봇 기본 언어와 같아도 남는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import * as userSettings from "../../src/store/user-settings.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
import { usersDb } from "../../src/store/users-db.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("user-settings-");
after(() => store.close());

const rowOf = (userId: string) => usersDb.get().prepare("SELECT data_json FROM user_settings WHERE user_id = ?").pluck().get(userId) as string | undefined;

test("개인 언어: 정한 적 없음(null), 직접 고른 자동(auto), 언어. 정한 적 없음으로 되돌리면 행을 지운다", () => {
  const seen: Array<[string, string[]]> = [];
  const off = userSettings.onChanged((userId, fields) => seen.push([userId, fields]));
  try {
    assert.equal(userSettings.languageOf("u1"), null);
    assert.deepEqual(userSettings.setLanguage("u1", "auto"), ["language"]);
    assert.equal(userSettings.languageOf("u1"), "auto");
    assert.equal(rowOf("u1"), '{"language":"auto"}', "직접 고른 자동은 값이라 남는다");
    assert.deepEqual(userSettings.setLanguage("u1", "auto"), [], "같은 값은 쓰지 않는다");
    userSettings.setLanguage("u1", "ko");
    userSettings.forgetCache();
    assert.equal(userSettings.languageOf("u1"), "ko", "다시 읽어도 같다");
    userSettings.setLanguage("u1", null);
    assert.equal(rowOf("u1"), undefined, "빈 문서를 남기지 않는다");
    assert.equal(userSettings.languageOf("u1"), null);
    assert.deepEqual(seen, [
      ["u1", ["language"]],
      ["u1", ["language"]],
      ["u1", ["language"]],
    ]);
  } finally {
    off();
  }
});

test("틀린 값(모르는 언어, 깨진 JSON)은 정하지 않은 것으로 읽는다", () => {
  const insert = usersDb.get().prepare("INSERT INTO user_settings (user_id, data_json) VALUES (?, ?)");
  insert.run("bad1", '{"language":"xx"}');
  insert.run("bad2", "{not json");
  userSettings.forgetCache();
  assert.equal(userSettings.languageOf("bad1"), null);
  assert.equal(userSettings.languageOf("bad2"), null);
});

test("모두 지우기: 표를 비우고 캐시도 버리며 설정이 있던 사람마다 알린다", () => {
  userSettings.setLanguage("u2", "ko");
  const seen: string[] = [];
  const off = userSettings.onChanged((userId) => seen.push(userId));
  try {
    userSettings.removeAll();
    assert.equal(userSettings.userCount(), 0);
    assert.equal(userSettings.languageOf("u2"), null);
    assert.ok(seen.includes("u2"));
  } finally {
    off();
  }
});

test("users.db의 구조 버전이 맞지 않으면 열지 않고 멈춘다(새로 만들어 선택을 지우지 않는다)", () => {
  const file = path.join(store.dir, "other-users.db");
  const db = new Database(file);
  db.exec("CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, data_json TEXT NOT NULL)");
  db.pragma("user_version = 99");
  db.close();
  const other = new (usersDb.constructor as new (spec: typeof usersDb.spec) => typeof usersDb)(usersDb.spec);
  assert.throws(
    () => other.open(file),
    (error: unknown) => codeOf(error) === "SCHEMA_MISMATCH" && /새로 만들지 않음/.test((error as Error).message),
  );
});

test("서버 언어: 봇 기본 언어와 같아도 남기고, null이면 봇 기본 언어를 따르게 뺀다", () => {
  assert.equal(guildSettings.resolveLanguage("g1"), null);
  assert.deepEqual(guildSettings.setLanguage("g1", "ko"), ["language"]);
  guildSettings.forgetCache();
  assert.equal(guildSettings.resolveLanguage("g1"), "ko");
  assert.deepEqual(guildSettings.read("g1"), { language: "ko" });
  guildSettings.setLanguage("g1", null);
  assert.deepEqual(guildSettings.read("g1"), {});
  assert.equal(guildSettings.resolveLanguage("g1"), null);
});

test("풀어 둔 전체 백업의 사람별 데이터 DB(users.restore.db)를 열기 전에 교체한다. 구조 버전이 다르면 교체하지 않고 멈춘다", async () => {
  const fs = await import("node:fs");
  const { applyStagedUsers, STAGED_USERS } = await import("../../src/store/users-db.ts");
  userSettings.setLanguage("moved", "ko");
  const dir = path.join(store.dir, "moved");
  fs.mkdirSync(dir);
  assert.equal(applyStagedUsers(dir), false, "풀어 둔 것이 없으면 그대로");
  await usersDb.get().backup(path.join(dir, STAGED_USERS));
  fs.writeFileSync(path.join(dir, "users.db-wal"), "옛 기록");
  assert.equal(applyStagedUsers(dir), true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["users.db"], "남은 -wal을 지우고 교체한다");
  const moved = new Database(path.join(dir, "users.db"), { readonly: true });
  assert.equal(moved.prepare("SELECT data_json FROM user_settings WHERE user_id = 'moved'").pluck().get(), '{"language":"ko"}');
  moved.close();

  const old = new Database(path.join(dir, STAGED_USERS));
  old.pragma("user_version = 99");
  old.close();
  assert.throws(
    () => applyStagedUsers(dir),
    (error: unknown) => codeOf(error) === "RESTORE_FAILED",
  );
  assert.ok(fs.existsSync(path.join(dir, "users.db")), "지금 것을 지우지 않는다");
});
