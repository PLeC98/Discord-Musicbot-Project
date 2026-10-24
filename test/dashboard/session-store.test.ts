// src/dashboard/session-store.ts — SQLite 세션 스토어
// 다시 시작해도 세션이 남는다(MemoryStore 는 잃는다). 임시 DB 를 쓰고 운영 sessions.db 는 건드리지 않는다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import type { SessionData } from "express-session";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import { fake } from "../helpers/fake.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-sess-"));
const stores: SqliteSessionStore[] = [];

function makeStore(name = "s.db") {
  const store = new SqliteSessionStore({ dbPath: path.join(tmpDir, name) });
  stores.push(store);
  return store;
}

after(() => {
  for (const s of stores) {
    try {
      s.close();
    } catch {}
  }
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

const getAsync = (store: SqliteSessionStore, sid: string) => new Promise<SessionData | null | undefined>((res, rej) => store.get(sid, (e, s) => (e ? rej(e) : res(s))));

// 저장소가 받는 모양 그대로(JSON 으로 오가 만료는 글자다). 사용자는 테스트가 보는 필드만
function makeSession(user: object, expiresInMs = 60_000) {
  return fake<SessionData>({ cookie: { expires: new Date(Date.now() + expiresInMs).toISOString() }, user });
}

test("set/get 라운드트립: 세션 객체 보존", async () => {
  const store = makeStore("roundtrip.db");
  const session = makeSession({ id: "u1", username: "tester", guilds: [{ id: "g1" }] });
  store.set("sid1", session);

  const loaded = await getAsync(store, "sid1");
  assert.deepEqual(loaded, session);
  assert.equal(await getAsync(store, "sid-없음"), null);
});

test("읽을 수 없는 세션 행은 없는 세션으로 보고 삭제한다(오류로 넘기면 그 쿠키의 요청이 모두 500 이 된다)", async () => {
  const store = makeStore("broken.db");
  store.set("sid1", makeSession({ id: "u1" }));
  store.db.prepare("UPDATE sessions SET data = ? WHERE sid = ?").run("{깨짐", "sid1");

  assert.equal(await getAsync(store, "sid1"), null);
  const left = store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE sid = ?").get("sid1") as { n: number };
  assert.equal(left.n, 0);
});

test("다시 시작 생존: 같은 DB 파일을 다시 열어도 세션 유지", async () => {
  const dbPath = path.join(tmpDir, "restart.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("sid1", makeSession({ id: "u1" }));
  first.close(); // 봇 다시 시작 시뮬레이션

  const second = new SqliteSessionStore({ dbPath });
  stores.push(second);
  const loaded = await getAsync(second, "sid1");
  assert.equal(loaded?.user?.id, "u1", "재시작 후에도 로그인 유지");
});

test("만료: 지난 세션은 null, prune이 만료분만 제거", async () => {
  const store = makeStore("expiry.db");
  store.set("살아있음", makeSession({ id: "a" }, 60_000));
  store.set("만료됨", makeSession({ id: "b" }, -1_000));

  assert.equal(await getAsync(store, "만료됨"), null, "만료 세션은 조회 불가");
  assert.equal(store.prune(), 1, "만료분 1건만 삭제");
  assert.notEqual(await getAsync(store, "살아있음"), null);
});

test("destroy: 로그아웃 시 즉시 제거", async () => {
  const store = makeStore("destroy.db");
  store.set("sid1", makeSession({ id: "u1" }));
  store.destroy("sid1");
  assert.equal(await getAsync(store, "sid1"), null);
});

test("touch: 만료를 연장해 prune에서 생존", async (t) => {
  const store = makeStore("touch.db");
  store.set("sid1", makeSession({ id: "u1" }, 1_000));
  store.touch("sid1", makeSession({ id: "u1" }, 120_000));

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 }); // 원래 만료(1초)보다 뒤, 연장(120초) 안쪽
  assert.equal(store.prune(), 0, "연장된 세션은 정리되지 않음");
  assert.notEqual(await getAsync(store, "sid1"), null);
});

test("cookie.expires 없는 세션(브라우저 세션 쿠키)은 폴백 TTL로 보관", async () => {
  const store = makeStore("fallback.db");
  store.set("sid1", fake<SessionData>({ cookie: {}, user: { id: "u1" } }));
  assert.notEqual(await getAsync(store, "sid1"), null, "즉시 만료되지 않음");
  assert.equal(store.prune(), 0);
});

test("디스코드 토큰: 세션 행에 암호문으로 두고, 세션을 다시 저장해도 남고, 세션과 함께 지워진다", async () => {
  secrets._useKey(newSecretsKey());
  try {
    const store = makeStore("token.db");
    assert.equal(store.saveDiscordToken("sid1", "tok-abc"), false, "행이 없으면(저장 전) 적지 않는다");
    store.set("sid1", makeSession({ id: "u1" }));
    assert.equal(store.saveDiscordToken("sid1", "tok-abc"), true);
    assert.equal(store.readDiscordToken("sid1"), "tok-abc");

    store.set("sid1", makeSession({ id: "u1", more: 1 }));
    assert.equal(store.readDiscordToken("sid1"), "tok-abc", "세션 저장은 토큰 열을 건드리지 않는다");
    assert.equal(JSON.stringify(await getAsync(store, "sid1")).includes("tok-abc"), false, "세션 JSON 에는 없다");

    store.destroy("sid1");
    assert.equal(store.readDiscordToken("sid1"), null);
  } finally {
    secrets._useKey();
  }
});

test("디스코드 토큰: 다른 세션 행으로 옮기거나 SECRETS_KEY 를 바꾸면 풀리지 않는다. DB 파일에 평문이 없다", () => {
  secrets._useKey(newSecretsKey());
  try {
    const store = makeStore("token-move.db");
    store.set("sid1", makeSession({ id: "u1" }));
    store.set("sid2", makeSession({ id: "u2" }));
    store.saveDiscordToken("sid1", "tok-secret-value");
    store.db.prepare("UPDATE sessions SET discord_token = (SELECT discord_token FROM sessions WHERE sid = 'sid1') WHERE sid = 'sid2'").run();
    assert.equal(store.readDiscordToken("sid2"), null, "세션 ID 에 묶여 있다");

    store.db.pragma("wal_checkpoint(TRUNCATE)");
    assert.equal(fs.readFileSync(path.join(tmpDir, "token-move.db")).includes("tok-secret-value"), false);

    secrets._useKey(newSecretsKey());
    assert.equal(store.readDiscordToken("sid1"), null, "다른 키");
  } finally {
    secrets._useKey();
  }
});

test("구조 버전이 다른 옛 파일(토큰 열이 없다)은 열지 않고 삭제를 안내한다", () => {
  const file = path.join(tmpDir, "old.db");
  const old = new Database(file);
  old.exec("CREATE TABLE sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  old.close();
  assert.throws(
    () => makeStore("old.db"),
    (error: Error & { code?: string }) => error.code === "SCHEMA_MISMATCH" && /로그인 세션 DB.*삭제/.test(error.message),
  );
});
