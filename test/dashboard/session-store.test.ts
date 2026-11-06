// src/dashboard/session-store.ts: SQLite 세션 스토어
// 다시 시작해도 세션이 남는다(MemoryStore 는 잃는다). 임시 DB 를 쓰고 운영 sessions.db 는 건드리지 않는다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import type { SessionData } from "express-session";
import Database from "better-sqlite3";
import type { Request } from "express";
import assert from "node:assert/strict";
import { SqliteSessionStore, SESSION_MAX_MS } from "../../src/dashboard/session-store.ts";
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

// 저장소가 받는 모양 그대로(JSON 으로 오가 만료는 글자다). 사용자는 테스트가 보는 필드만. loginAt: 로그인한 때(기본은 지금, null 이면 없음)
function makeSession(user: object, expiresInMs = 60_000, loginAt: number | null = Date.now()) {
  return fake<SessionData>({ cookie: { expires: new Date(Date.now() + expiresInMs).toISOString() }, user, ...(loginAt === null ? {} : { loginAt }) });
}
const DAY = 24 * 60 * 60_000;
const rowOf = (store: SqliteSessionStore, sid: string) => store.db.prepare("SELECT expires_at FROM sessions WHERE sid = ?").get(sid) as { expires_at: number } | undefined;

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

test("만료: 지난 세션은 null, prune이 만료분만 제거", async (t) => {
  const store = makeStore("expiry.db");
  store.set("살아있음", makeSession({ id: "a" }, 60_000));
  store.set("만료됨", makeSession({ id: "b" }, 1_000));
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 2_000 });

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
  store.set("sid1", fake<SessionData>({ cookie: {}, user: { id: "u1" }, loginAt: Date.now() }));
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

// ── 끝낸 세션, 절대 수명 ──

test("끝낸 로그인 세션은 그 세션으로 걸려 있던 저장이 다시 넣지 못한다(로그아웃, 다른 기기 로그아웃, 정리). 하루가 지나도", async (t) => {
  const store = makeStore("tomb.db");
  const session = makeSession({ id: "u1" }, 7 * DAY);
  store.set("끝냄", session);
  store.destroy("끝냄");
  store.set("끝냄", session); // 걸려 있던 요청의 저장
  assert.equal(rowOf(store, "끝냄"), undefined);
  store.touch("끝냄", session);
  assert.equal(rowOf(store, "끝냄"), undefined, "시각 늘리기도");

  // 흘려 보내는 응답을 천천히 읽어 하루 넘게 걸린 저장
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 2 * DAY });
  store.set("끝냄", session);
  assert.equal(rowOf(store, "끝냄"), undefined, "절대 기한까지 막는다");
});

test("만료한 행은 정리 전이어도 다시 늘리지 않는다(저장, 시각 늘리기 둘 다)", async (t) => {
  const store = makeStore("expired-renew.db");
  store.set("만료", makeSession({ id: "u1" }, 1_000));
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5_000 });
  store.touch("만료", makeSession({ id: "u1" }, 60_000));
  assert.ok((rowOf(store, "만료")?.expires_at ?? 0) <= Date.now(), "시각 늘리기");
  store.set("만료", makeSession({ id: "u1" }, 60_000));
  assert.equal(await getAsync(store, "만료"), null, "저장");
  assert.ok(!rowOf(store, "만료") || rowOf(store, "만료")!.expires_at <= Date.now());
});

test("정리가 지운 로그인 세션도 걸려 있던 저장이 다시 넣지 못한다. 지운 것을 알린다", async (t) => {
  const store = makeStore("prune-tomb.db");
  const ended: string[] = [];
  store.onEnded((sid) => ended.push(sid));
  const session = makeSession({ id: "u1" }, 1_000);
  store.set("정리됨", session);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5_000 });
  assert.equal(store.prune(), 1);
  assert.deepEqual(ended, ["정리됨"]);
  store.set("정리됨", makeSession({ id: "u1" }, 60_000, session.loginAt));
  assert.equal(rowOf(store, "정리됨"), undefined);
});

test("절대 수명: 로그인한 지 30일이 넘은 세션은 쓰지도 읽지도 않는다. 만료는 로그인 시각 + 30일을 넘지 않는다", async () => {
  const store = makeStore("absolute.db");
  const ended: string[] = [];
  store.onEnded((sid) => ended.push(sid));
  const loginAt = Date.now() - SESSION_MAX_MS + 60_000; // 1분 남음
  store.set("곧", makeSession({ id: "u1" }, 7 * DAY, loginAt));
  assert.ok(Math.abs((rowOf(store, "곧")?.expires_at ?? 0) - (loginAt + SESSION_MAX_MS)) < 5, "쿠키 7일이 아니라 절대 기한");

  store.set("넘음", makeSession({ id: "u1" }, 7 * DAY, Date.now() - SESSION_MAX_MS - 1));
  assert.equal(rowOf(store, "넘음"), undefined, "넘은 것은 쓰지 않는다");
  store.set("로그인 시각 없음", makeSession({ id: "u1" }, 7 * DAY, null));
  assert.equal(rowOf(store, "로그인 시각 없음"), undefined, "로그인했는데 시각이 없으면 만료로 본다");

  // 이 규칙 전에 쓴 행: 읽을 때 지우고 알린다
  store.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)").run("옛 행", JSON.stringify(makeSession({ id: "u1" }, 7 * DAY, Date.now() - 40 * DAY)), Date.now() + 7 * DAY);
  assert.equal(await getAsync(store, "옛 행"), null);
  assert.equal(rowOf(store, "옛 행"), undefined);
  assert.deepEqual(ended, ["넘음", "로그인 시각 없음", "옛 행"], "쓰지 않은 것, 읽다 지운 것 모두 끝났다고 알린다");
  assert.deepEqual(
    store.sessionsOf("u1").map(({ sid }) => sid),
    ["곧"],
    "로그인 기기 목록에도 넘은 것은 없다",
  );
  // 로그인 전 세션(사용자 없음)은 이 규칙 밖
  store.set("로그인 전", fake<SessionData>({ cookie: { expires: new Date(Date.now() + 600_000).toISOString() }, oauthState: "x" }));
  assert.notEqual(await getAsync(store, "로그인 전"), null);
});

test("다시 시작: 이 규칙 전에 쓴 행의 만료를 절대 기한으로 줄이고, 넘은 것은 지운다", () => {
  const dbPath = path.join(tmpDir, "normalize.db");
  const first = new SqliteSessionStore({ dbPath });
  const loginAt = Date.now() - 29 * DAY;
  const insert = first.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)");
  insert.run("29일", JSON.stringify(makeSession({ id: "u1" }, 7 * DAY, loginAt)), Date.now() + 7 * DAY);
  insert.run("40일", JSON.stringify(makeSession({ id: "u1" }, 7 * DAY, Date.now() - 40 * DAY)), Date.now() + 7 * DAY);
  insert.run("시각 없음", JSON.stringify(makeSession({ id: "u1" }, 7 * DAY, null)), Date.now() + 7 * DAY);
  first.close();

  const second = new SqliteSessionStore({ dbPath });
  stores.push(second);
  assert.ok(Math.abs((rowOf(second, "29일")?.expires_at ?? 0) - (loginAt + SESSION_MAX_MS)) < 5);
  assert.equal(rowOf(second, "40일"), undefined);
  assert.equal(rowOf(second, "시각 없음"), undefined);
});

test("끝 알림: 듣는 쪽이 던져도 지우기는 성공으로 끝나고 다른 듣는 쪽도 듣는다. 콜백은 한 번", () => {
  const store = makeStore("listeners.db");
  const heard: string[] = [];
  store.onEnded(() => {
    throw new Error("듣는 쪽 오류");
  });
  store.onEnded((sid) => heard.push(sid));
  store.set("sid1", makeSession({ id: "u1" }));
  let calls = 0;
  let failed: unknown = null;
  store.destroy("sid1", (error) => {
    calls++;
    failed = error ?? null;
  });
  assert.deepEqual([calls, failed, heard], [1, null, ["sid1"]]);
});

// 지우기(DELETE)만 실패하게 한다(디스크가 가득 참). 되돌리는 함수를 돌려준다
function breakDelete(store: SqliteSessionStore) {
  const real = store._deleteStmt;
  store._deleteStmt = fake<typeof real>({
    get() {
      throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    },
  });
  return () => (store._deleteStmt = real);
}

test("지우기가 실패해도 닫힌 쪽으로: 묘비를 남겨 읽지도 쓰지도 않고, 끝을 알리고, 실패를 콜백으로 넘긴다. 기기 목록에도 없다", async () => {
  const store = makeStore("delete-fails.db");
  const heard: string[] = [];
  store.onEnded((sid) => heard.push(sid));
  store.set("sid1", makeSession({ id: "u1" }));
  const restore = breakDelete(store);
  let failed: unknown = null;
  store.destroy("sid1", (error) => (failed = error));
  restore();
  assert.equal((failed as { code?: string } | null)?.code, "SQLITE_FULL");
  assert.deepEqual(heard, ["sid1"], "열린 스트림, 진행 중인 요청이 끊긴다");
  assert.ok(rowOf(store, "sid1"), "행은 남았다");
  assert.equal(await getAsync(store, "sid1"), null, "이 실행에서는 읽지 않는다");
  assert.deepEqual(store.sessionsOf("u1"), [], "끊은 기기를 살아 있다고 보이지 않는다");
  assert.deepEqual(store.unsavedOf("u1"), [], "destroy 는 사용자를 모른다");
  assert.equal(store.isUnsaved("sid1"), true);
});

test("못 지운 행은 다시 지운다(DB 가 돌아오면). 끝(finish)에도 남으면 그 수를 알린다", () => {
  const store = makeStore("delete-retry.db");
  store.set("a", makeSession({ id: "u1" }));
  store.set("b", makeSession({ id: "u1" }));
  const restore = breakDelete(store);
  assert.equal(store.end("a", "u1"), false);
  assert.equal(store.end("b", "u1"), false);
  assert.deepEqual(store.unsavedOf("u1").sort(), ["a", "b"]);
  assert.equal(store.retryUnsaved(), 2, "아직 못 지움");
  assert.equal(store.finish(), 2, "끝에도 남았다");
  restore();
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(rowOf(store, "a"), undefined);
  assert.equal(rowOf(store, "b"), undefined);
  assert.equal(store.isUnsaved("a"), false);
  assert.equal(store.finish(), 0);
});

test("다시 로그인(regenerate)의 지우기가 실패하면 그 사용자의 못 지운 것으로 둔다. 새 세션은 만든다", async () => {
  const store = makeStore("regen-fails.db");
  store.set("old", makeSession({ id: "u7" }));
  let generated = 0;
  store.generate = () => void generated++;
  const restore = breakDelete(store);
  let failed: unknown = null;
  store.regenerate(fake<Request>({ sessionID: "old", session: fake<Request["session"]>({ user: { id: "u7", username: "u7", globalName: "u7", avatar: null } }) }), (error) => (failed = error));
  restore();
  assert.equal(generated, 1);
  assert.ok(failed);
  assert.deepEqual(store.unsavedOf("u7"), ["old"]);
  assert.equal(await getAsync(store, "old"), null);
});
