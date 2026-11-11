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
import sink from "../../src/infra/log/sink.ts";
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

// 저장소가 받는 형태 그대로 만든다(JSON으로 오가므로 만료 시각은 문자열이다). 사용자는 테스트가 보는 필드만 넣고, loginAt은 로그인 시각이다(기본값은 현재 시각, null이면 없음).
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

test("만료: 만료된 세션은 null을 반환하고, prune은 만료된 세션만 삭제한다", async (t) => {
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

test("종료된 로그인 세션은 진행 중이던 요청이 뒤늦게 저장해도 다시 생기지 않는다. 하루가 지나도 마찬가지다(로그아웃, 다른 기기 로그아웃, 정리)", async (t) => {
  const store = makeStore("tomb.db");
  const session = makeSession({ id: "u1" }, 7 * DAY);
  store.set("끝냄", session);
  store.destroy("끝냄");
  store.set("끝냄", session); // 진행 중이던 요청의 뒤늦은 저장이다
  assert.equal(rowOf(store, "끝냄"), undefined);
  store.touch("끝냄", session);
  assert.equal(rowOf(store, "끝냄"), undefined, "만료 연장도 막는다");

  // 스트리밍 응답을 천천히 읽어 하루 넘게 걸린 요청이 뒤늦게 저장한다
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 2 * DAY });
  store.set("끝냄", session);
  assert.equal(rowOf(store, "끝냄"), undefined, "절대 기한까지 막는다");
});

test("만료된 행은 정리 전이어도 다시 연장하지 않는다(저장, 만료 연장 둘 다)", async (t) => {
  const store = makeStore("expired-renew.db");
  store.set("만료", makeSession({ id: "u1" }, 1_000));
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5_000 });
  store.touch("만료", makeSession({ id: "u1" }, 60_000));
  assert.ok((rowOf(store, "만료")?.expires_at ?? 0) <= Date.now(), "만료 연장");
  store.set("만료", makeSession({ id: "u1" }, 60_000));
  assert.equal(await getAsync(store, "만료"), null, "저장");
  assert.ok(!rowOf(store, "만료") || rowOf(store, "만료")!.expires_at <= Date.now());
});

test("정리(prune)가 삭제한 로그인 세션도 진행 중이던 요청이 다시 저장하지 못하며, 삭제된 것을 알린다", async (t) => {
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

  // 이 규칙 전에 쓴 행: 읽을 때 삭제하고 알린다
  store.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)").run("옛 행", JSON.stringify(makeSession({ id: "u1" }, 7 * DAY, Date.now() - 40 * DAY)), Date.now() + 7 * DAY);
  assert.equal(await getAsync(store, "옛 행"), null);
  assert.equal(rowOf(store, "옛 행"), undefined);
  assert.deepEqual(ended, ["넘음", "로그인 시각 없음", "옛 행"], "쓰지 않은 것, 읽다 삭제한 것 모두 끝났다고 알린다");
  assert.deepEqual(
    store.sessionsOf("u1").map(({ sid }) => sid),
    ["곧"],
    "로그인 기기 목록에도 넘은 것은 없다",
  );
  // 로그인 전 세션(사용자 없음)은 이 규칙 대상이 아니다
  store.set("로그인 전", fake<SessionData>({ cookie: { expires: new Date(Date.now() + 600_000).toISOString() }, csrfToken: "x" }));
  assert.notEqual(await getAsync(store, "로그인 전"), null);
});

test("다시 시작: 이 규칙 전에 쓴 행의 만료를 절대 기한으로 줄이고, 넘은 것은 삭제한다", () => {
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

test("종료 알림: 리스너가 예외를 던져도 삭제는 성공으로 끝나고 다른 리스너도 호출된다. 콜백은 한 번만 호출된다", () => {
  const store = makeStore("listeners.db");
  const heard: string[] = [];
  store.onEnded(() => {
    throw new Error("리스너 오류");
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

// 삭제(DELETE)만 실패하게 한다(디스크가 가득 참). 되돌리는 함수를 돌려준다
function breakDelete(store: SqliteSessionStore) {
  const real = store._deleteStmt;
  store._deleteStmt = fake<typeof real>({
    get() {
      throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    },
  });
  return () => (store._deleteStmt = real);
}

test("삭제가 실패해도 세션은 종료된 것으로 처리한다: 묘비를 남겨 읽지도 쓰지도 않고, 종료를 알리고, 실패를 콜백으로 넘긴다. 기기 목록에도 없다", async () => {
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
  assert.deepEqual(store.unsavedOf("u1"), [], "destroy는 사용자를 모른다");
  assert.equal(store.isUnsaved("sid1"), true);
});

test("삭제하지 못한 행은 다시 삭제한다(DB가 돌아오면). 종료(finish) 시점에도 남으면 그 개수를 반환한다", () => {
  const store = makeStore("delete-retry.db");
  store.set("a", makeSession({ id: "u1" }));
  store.set("b", makeSession({ id: "u1" }));
  const restore = breakDelete(store);
  assert.equal(store.end("a", "u1"), false);
  assert.equal(store.end("b", "u1"), false);
  assert.deepEqual(store.unsavedOf("u1").sort(), ["a", "b"]);
  assert.equal(store.retryUnsaved(), 2, "아직 삭제하지 못함");
  assert.equal(store.finish(), 2, "끝에도 남았다");
  restore();
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(rowOf(store, "a"), undefined);
  assert.equal(rowOf(store, "b"), undefined);
  assert.equal(store.isUnsaved("a"), false);
  assert.equal(store.finish(), 0);
});

test("다시 로그인(regenerate)할 때 이전 세션 삭제가 실패하면 해당 사용자의 미삭제 세션으로 기록하고 새 세션은 만든다", async () => {
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

// ── 한 DB 파일에 저장소 하나, 세션을 끊는 삭제는 디스크까지 쓰기 ──

test("한 DB 파일에는 저장소 하나: 같은 파일을 열고 있는 저장소가 있으면 다른 표기로 열어도 예외를 던지고, 기존 저장소를 닫으면 다시 열 수 있다", () => {
  const dbPath = path.join(tmpDir, "one.db");
  const first = makeStore("one.db");
  first.set("sid1", makeSession({ id: "u1" }));
  for (const other of [dbPath, path.join(tmpDir, "x", "..", "one.db"), ...(process.platform === "win32" ? [path.join(tmpDir, "ONE.DB")] : [])]) {
    assert.throws(() => new SqliteSessionStore({ dbPath: other }), /열고 있는 저장소가 이미 있음/, other);
  }
  first.close();
  const second = makeStore("one.db");
  assert.ok(rowOf(second, "sid1"), "기존 저장소를 닫으면 같은 파일을 다시 열 수 있다");
});

// 쿼리가 실행되는 시점의 synchronous 값을 기록한다(2는 FULL, 1은 NORMAL). 원래대로 되돌리는 함수를 반환한다
function watchSync<K extends "_deleteStmt" | "_pruneStmt" | "_setStmt">(store: SqliteSessionStore, key: K, seen: string[], label: string) {
  const real = store[key];
  store[key] = new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        seen.push(`${label} ${store.db.pragma("synchronous", { simple: true }) as number}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return () => (store[key] = real);
}

test("세션을 끊는 삭제(로그아웃, 다른 기기 로그아웃, 다시 로그인, 다시 삭제)만 FULL로 디스크까지 쓰고 끝나면 NORMAL로 돌아간다. 저장, 정리, 만료 삭제는 NORMAL 그대로 둔다", async (t) => {
  const store = makeStore("durable.db");
  const sync = () => store.db.pragma("synchronous", { simple: true }) as number;
  assert.equal(sync(), 1);
  for (const sid of ["로그아웃", "다른 기기", "다시 로그인", "다시 삭제"]) store.set(sid, makeSession({ id: "u1" }));
  store.generate = () => {};
  const seen: string[] = [];

  // 다시 삭제할 것을 하나 만든다
  const restore = breakDelete(store);
  assert.equal(store.end("다시 삭제", "u1"), false);
  restore();

  const undo = [watchSync(store, "_deleteStmt", seen, "삭제"), watchSync(store, "_setStmt", seen, "저장"), watchSync(store, "_pruneStmt", seen, "정리")];
  store.destroy("로그아웃");
  assert.equal(store.end("다른 기기", "u1"), true);
  store.regenerate(fake<Request>({ sessionID: "다시 로그인", session: fake<Request["session"]>({ user: { id: "u1", username: "u1", globalName: "u1", avatar: null } }) }), () => {});
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(sync(), 1, "세션을 끊는 삭제가 끝나면 NORMAL");

  store.set("저장", makeSession({ id: "u2" }, 1_000));
  store.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)").run("절대 기한 넘음", JSON.stringify(makeSession({ id: "u2" }, 7 * DAY, Date.now() - 40 * DAY)), Date.now() + 7 * DAY);
  assert.equal(await getAsync(store, "절대 기한 넘음"), null);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5_000 });
  assert.equal(store.prune(), 1);
  for (const fn of undo) fn();

  assert.deepEqual(seen, ["삭제 2", "삭제 2", "삭제 2", "삭제 2", "저장 1", "삭제 1", "정리 1"]);
  assert.equal(sync(), 1);
});

// ── 끊은 세션을 지우지 못하면 다음 기동 시 로그인 세션을 모두 지운다 ──

const markerOf = (name: string) => `${fs.realpathSync.native(path.join(tmpDir, name))}-intact`;
// 이 시점 이후에 찍힌 warn, error 로그
function logsFrom() {
  const start = sink.buffer.at(-1)?.id ?? -1;
  return () => sink.buffer.filter((r) => r.id > start && (r.level === "warn" || r.level === "error")).map((r) => `${r.level} ${r.text}`);
}
// 표시 파일이 "끊은 세션 없음"("1")인가
const intact = (name: string) => {
  try {
    return fs.readFileSync(markerOf(name), "utf8") === "1";
  } catch {
    return false;
  }
};
type Mocker = { mock: { method: typeof import("node:test").mock.method } };
const isMarker = (file: unknown) => String(file).endsWith("-intact");
// 표시 파일에서만 예외를 던지게 하고 나머지 파일은 그대로 둔다. drop: "0"으로 고치기와 지우기, restore: "1"로 되돌리기. 원래대로 되돌리는 함수를 반환한다
function failOnMarker(t: Mocker, what: "drop" | "restore", code = "EBUSY") {
  const fail = () => {
    throw Object.assign(new Error(`${code}: marker`), { code });
  };
  const open = fs.openSync as (...args: unknown[]) => number;
  const rm = fs.rmSync as (...args: unknown[]) => void;
  const mocks: Array<{ mock: { restore(): void } }> = [t.mock.method(fs, "openSync", ((file: unknown, flags: unknown, ...rest: unknown[]) => (isMarker(file) && flags === (what === "drop" ? "r+" : "w") ? fail() : open.call(fs, file, flags, ...rest))) as never)];
  if (what === "drop") mocks.push(t.mock.method(fs, "rmSync", ((file: unknown, ...rest: unknown[]) => (isMarker(file) ? fail() : rm.call(fs, file, ...rest))) as never));
  return () => mocks.forEach((one) => one.mock.restore());
}
// 기동 시 전체 삭제를 포함해 행 삭제가 모두 실패하게 하는 트리거
const blockDeletes = (db: Database.Database) => db.exec("CREATE TRIGGER block_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END");

test("끊은 세션을 지우지 못한 채 다시 시작하면(강제 종료 포함) 기동 시 로그인 세션을 모두 지워 끊은 세션이 되살아나지 않는다", async () => {
  const store = makeStore("revive.db");
  assert.ok(intact("revive.db"), "새 DB 파일이어도 기동 시 표시 파일을 만든다");
  store.set("끊음", makeSession({ id: "u1" }));
  store.set("다른 사용자", makeSession({ id: "u2" }));
  const logs = logsFrom();
  breakDelete(store);
  assert.equal(store.end("끊음", "u1"), false);
  assert.equal(intact("revive.db"), false, "행 삭제 전에 표시 파일을 지운다");
  assert.match(logs().join("\n"), /다시 시작하면 로그인 세션을 모두 삭제/);
  store.close(); // finish 호출 없는 강제 종료

  const next = logsFrom();
  const again = makeStore("revive.db");
  assert.equal(await getAsync(again, "끊음"), null);
  assert.equal(rowOf(again, "끊음"), undefined);
  assert.equal(rowOf(again, "다른 사용자"), undefined, "어느 것이 끊은 것인지 모르니 모두 지운다");
  assert.ok(intact("revive.db"));
  const lines = next().filter((line) => line.includes("로그인 세션"));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /^warn .*표시.*확인하지 못해 기동 시 로그인 세션 2개 삭제/);
});

test("표시 파일이 있으면 기동 시 세션을 지우지 않는다. 세션을 끊고 행 삭제에 성공하면 표시 파일을 다시 만들고, 지울 행이 없는 세션을 끊을 때는 표시 파일을 건드리지 않는다", (t) => {
  const store = makeStore("kept.db");
  store.set("끊음", makeSession({ id: "u1" }));
  store.set("남음", makeSession({ id: "u1" }));
  store.generate = () => {};
  const removed: string[] = [];
  const open = fs.openSync as (...args: unknown[]) => number;
  t.mock.method(fs, "openSync", ((file: unknown, flags: unknown, ...rest: unknown[]) => {
    if (isMarker(file) && flags === "r+") removed.push("표시");
    return open.call(fs, file, flags, ...rest);
  }) as never);
  store.regenerate(fake<Request>({ sessionID: "행 없음", session: fake<Request["session"]>({}) }), () => {});
  assert.deepEqual(removed, [], "되살아날 것이 없으면 건드리지 않는다");
  assert.equal(store.end("끊음", "u1"), true);
  assert.deepEqual(removed, ["표시"]);
  assert.ok(intact("kept.db"), "세션을 끊고 행 삭제에 성공하면 표시 파일을 다시 만든다");
  store.close();

  const again = makeStore("kept.db");
  assert.ok(rowOf(again, "남음"), "표시 파일이 있으면 기동 시 세션을 지우지 않는다");
});

test("다른 프로그램이 열어 두어 표시 파일을 지우지 못해도 행 삭제는 그대로 시도하고, 행 삭제도 실패했을 때만 다시 시작하면 되살아난다고 로그에 남긴다", (t) => {
  const store = makeStore("busy-marker.db");
  store.set("a", makeSession({ id: "u1" }));
  store.set("b", makeSession({ id: "u1" }));
  failOnMarker(t, "drop");
  const logs = logsFrom();
  assert.equal(store.end("a", "u1"), true);
  assert.equal(rowOf(store, "a"), undefined);
  assert.deepEqual(logs(), [], "행을 지웠으니 되살아날 것이 없다");
  const restore = breakDelete(store);
  assert.equal(store.end("b", "u1"), false);
  restore();
  assert.match(logs().join("\n"), /^error .*다시 시작하면 그 로그인이 되살아남/m);
  assert.equal(store.retryUnsaved(), 0);
});

test("표시 파일을 지우지 못한 채 행 삭제도 실패하면 다시 하기에서 표시 파일을 다시 지운다. 그 뒤 종료하면 다음 기동 시 로그인 세션을 모두 지운다고 로그에 남긴다", (t) => {
  const store = makeStore("busy-then-free.db");
  store.set("a", makeSession({ id: "u1" }));
  const free = failOnMarker(t, "drop");
  breakDelete(store);
  assert.equal(store.end("a", "u1"), false);
  assert.ok(intact("busy-then-free.db"), "잠긴 표시 파일은 남는다");
  free();
  assert.equal(store.retryUnsaved(), 1);
  assert.equal(intact("busy-then-free.db"), false, "다시 하기에서 표시 파일을 지운다");
  const logs = logsFrom();
  assert.equal(store.finish(), 1);
  assert.match(
    logs()
      .filter((line) => line.startsWith("error 끊은 로그인 세션 1개를"))
      .join("\n"),
    /다시 시작하면 로그인 세션을 모두 삭제/,
  );
});

test("표시 파일을 만들지 못하면 warn을 남기고, 그 상태로 다시 시작하면 기동 시 로그인 세션을 다시 모두 지운다. 다시 하기에서 표시 파일을 다시 만든다", (t) => {
  const store = makeStore("no-marker.db");
  store.set("끊음", makeSession({ id: "u1" }));
  store.set("남음", makeSession({ id: "u1" }));
  const undo = failOnMarker(t, "restore", "ENOSPC");
  const logs = logsFrom();
  assert.equal(store.end("끊음", "u1"), true);
  assert.equal(intact("no-marker.db"), false);
  assert.ok(logs().some((line) => line.startsWith("warn ") && line.includes("다시 시작하면 로그인 세션을 모두 삭제")));
  assert.ok(store._retryTimer, "다시 하기 타이머가 켜져 있다");
  assert.equal(store.retryUnsaved(), 0);
  assert.ok(store._retryTimer, "표시 파일을 만들 때까지 타이머를 끄지 않는다");
  undo();
  assert.equal(store.retryUnsaved(), 0);
  assert.ok(intact("no-marker.db"), "다시 하기에서 만든다");
  assert.equal(store._retryTimer, null, "다 되면 타이머를 끈다");
});

test("기동 시 세션을 모두 지울 때도 FULL로 디스크까지 쓰고 끝나면 NORMAL로 돌아간다", (t) => {
  const dbPath = path.join(tmpDir, "wipe-durable.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("로그인", makeSession({ id: "u1" }));
  first.close();
  fs.rmSync(markerOf("wipe-durable.db"));

  const seen: number[] = [];
  const prepare = Database.prototype.prepare;
  t.mock.method(Database.prototype, "prepare", function (this: Database.Database, sql: string) {
    const statement = prepare.call(this, sql);
    if (sql !== "DELETE FROM sessions") return statement;
    const run = statement.run.bind(statement) as () => Database.RunResult;
    return Object.assign(statement, { run: () => (seen.push(this.pragma("synchronous", { simple: true }) as number), run()) });
  });
  const store = makeStore("wipe-durable.db");
  t.mock.restoreAll();
  assert.deepEqual(seen, [2]);
  assert.equal(store.db.pragma("synchronous", { simple: true }), 1);
  assert.equal(rowOf(store, "로그인"), undefined);
});

test("기동 시 전체 삭제가 실패하면 기동 전 세션(사용자 없는 세션 포함)을 현재 실행에서 허용하지 않고, 다시 하기에서 모두 지우면 표시 파일을 만든다", async () => {
  const dbPath = path.join(tmpDir, "wipe-fails.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("로그인", makeSession({ id: "u1" }));
  first.set("로그인 전", fake<SessionData>({ cookie: { expires: new Date(Date.now() + 600_000).toISOString() }, csrfToken: "x" }));
  blockDeletes(first.db);
  first.close();
  fs.rmSync(markerOf("wipe-fails.db"));

  const logs = logsFrom();
  const store = makeStore("wipe-fails.db");
  assert.match(logs().join("\n"), /^error 기동 시 로그인 세션 삭제 실패/m);
  assert.equal(await getAsync(store, "로그인"), null);
  assert.equal(await getAsync(store, "로그인 전"), null, "사용자 없는 세션도 허용하지 않는다");
  assert.deepEqual(store.sessionsOf("u1"), []);
  assert.deepEqual(store.unsavedOf("u1"), ["로그인"]);
  assert.equal(intact("wipe-fails.db"), false);

  store.db.exec("DROP TRIGGER block_delete");
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(rowOf(store, "로그인"), undefined);
  assert.equal(rowOf(store, "로그인 전"), undefined);
  assert.ok(intact("wipe-fails.db"));
});

test('표시 파일은 지우지 않고 내용을 바꾼다: 세션을 끊는 동안 "0", 끝나면 "1". 바꿀 때마다 디스크까지 쓴다(fsync). "1"이 아니면(옛 빈 파일 포함) 기동 시 모두 지운다', (t) => {
  const store = makeStore("content.db");
  store.set("a", makeSession({ id: "u1" }));
  store.set("b", makeSession({ id: "u1" }));
  const restore = breakDelete(store);
  let synced = 0;
  const fsync = fs.fsyncSync;
  t.mock.method(fs, "fsyncSync", (fd: number) => {
    synced++;
    return fsync.call(fs, fd);
  });
  assert.equal(store.end("a", "u1"), false);
  assert.equal(fs.readFileSync(markerOf("content.db"), "utf8"), "0", "파일은 남고 내용만 바뀐다");
  assert.equal(synced, 1, "0으로 바꾸고 디스크까지 쓴다");
  restore();
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(fs.readFileSync(markerOf("content.db"), "utf8"), "1");
  assert.equal(synced, 2, "1로 되돌리고 디스크까지 쓴다");
  store.close();

  fs.writeFileSync(markerOf("content.db"), "");
  const again = makeStore("content.db");
  assert.equal(rowOf(again, "b"), undefined, "내용이 1이 아니면 모두 지운다");
  assert.ok(intact("content.db"));
});

test("여러 세션을 함께 끊으면 표시 파일은 처음에 한 번 바꾸고 마지막에 한 번 되돌린다(세션마다 디스크까지 쓰지 않는다)", (t) => {
  const store = makeStore("batch.db");
  for (const sid of ["a", "b", "c"]) store.set(sid, makeSession({ id: "u1" }));
  const heard: string[] = [];
  store.onEnded((sid) => heard.push(sid));
  let synced = 0;
  const fsync = fs.fsyncSync;
  t.mock.method(fs, "fsyncSync", (fd: number) => {
    synced++;
    return fsync.call(fs, fd);
  });
  assert.deepEqual(store.endAll(["a", "b", "c"], "u1"), [true, true, true]);
  assert.equal(synced, 2);
  assert.ok(intact("batch.db"));
  assert.deepEqual(heard, ["a", "b", "c"]);
  assert.deepEqual(store.sessionsOf("u1"), []);
});

test("기동 시 전체 삭제와 행 읽기가 모두 실패하면 이번 실행에서 처음 저장한 세션만 받고, 다시 하기에서 읽히면 기동 전 세션을 지운 뒤 표시 파일을 되돌린다", async (t) => {
  const dbPath = path.join(tmpDir, "unreadable.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("기동 전", makeSession({ id: "u1" }));
  blockDeletes(first.db);
  first.close();
  fs.rmSync(markerOf("unreadable.db"));

  let unreadable = true;
  const prepare = Database.prototype.prepare;
  t.mock.method(Database.prototype, "prepare", function (this: Database.Database, sql: string) {
    if (unreadable && sql === "SELECT sid, data FROM sessions") throw Object.assign(new Error("disk I/O error"), { code: "SQLITE_IOERR" });
    return prepare.call(this, sql);
  });
  const logs = logsFrom();
  const store = makeStore("unreadable.db");
  assert.match(logs().join("\n"), /^error 기동 시 로그인 세션 삭제와 읽기 실패/m);
  assert.equal(await getAsync(store, "기동 전"), null);
  assert.deepEqual(store.sessionsOf("u1"), []);
  store.set("이번 실행", makeSession({ id: "u2" }));
  assert.equal((await getAsync(store, "이번 실행"))?.user?.id, "u2", "이번 실행에서 처음 저장한 세션은 받는다");
  assert.equal(intact("unreadable.db"), false);
  assert.equal(store.retryUnsaved(), 0, "아직 읽지 못하면 다시 하기도 가려낼 것이 없다");
  assert.equal(intact("unreadable.db"), false, "기동 전 세션을 가려낼 때까지 표시 파일을 되돌리지 않는다");

  unreadable = false;
  store.db.exec("DROP TRIGGER block_delete");
  assert.equal(store.retryUnsaved(), 0);
  assert.equal(rowOf(store, "기동 전"), undefined);
  assert.equal((await getAsync(store, "이번 실행"))?.user?.id, "u2");
  assert.ok(intact("unreadable.db"));
});

test("기동 시 전체 삭제와 정리가 모두 실패해도(디스크 가득 참) 저장소는 열리고, 기동 전 세션은 허용하지 않는다", async () => {
  const dbPath = path.join(tmpDir, "boot-fails.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("로그인", makeSession({ id: "u1" }));
  first.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)").run("만료", JSON.stringify(makeSession({ id: "u1" })), Date.now() - 1_000);
  blockDeletes(first.db);
  first.close();
  fs.rmSync(markerOf("boot-fails.db"));

  const logs = logsFrom();
  const store = makeStore("boot-fails.db");
  assert.equal(await getAsync(store, "로그인"), null);
  assert.ok(
    logs().some((line) => line.startsWith("warn 만료된 로그인 세션 정리 실패")),
    logs().join("\n"),
  );
});

test("종료(finish) 시 삭제하지 못한 세션이 남았을 때 표시 파일을 지웠으면 다음 기동 시 모두 지운다고 남기고, 표시 파일이 남았으면 되살아난다고 로그에 남긴다", (t) => {
  const store = makeStore("finish-text.db");
  store.set("a", makeSession({ id: "u1" }));
  store.set("b", makeSession({ id: "u1" }));
  breakDelete(store);
  store.end("a", "u1");
  const logs = logsFrom();
  assert.equal(store.finish(), 1);
  const finished = (lines: string[]) => lines.filter((line) => line.startsWith("error 끊은 로그인 세션 1개를"));
  assert.match(finished(logs()).join("\n"), /^error .*다시 시작하면 로그인 세션을 모두 삭제/);

  const other = makeStore("finish-text-2.db");
  other.set("a", makeSession({ id: "u1" }));
  failOnMarker(t, "drop");
  breakDelete(other);
  other.end("a", "u1");
  const later = logsFrom();
  assert.equal(other.finish(), 1);
  assert.match(finished(later()).join("\n"), /^error .*다시 시작하면 그 로그인이 되살아나/);
});

// ── 기기 기록 표, 쿠키 만료 ──

test("기기 기록: 만료 전 세션 행이 있을 때만 적고, 끝낸 세션에는 적지 않는다. 세션을 저장해도 남고 세션 행과 함께 지워진다", (t) => {
  const store = makeStore("devices.db");
  const blob = Buffer.from("암호문");
  assert.equal(store.saveDevice("없음", blob), false, "행이 없다");
  store.set("a", makeSession({ id: "u1" }, 1_000));
  assert.equal(store.saveDevice("a", blob), true);
  assert.deepEqual(store.readDevice("a"), blob);
  store.set("a", makeSession({ id: "u1" }, 1_000));
  assert.deepEqual(store.readDevice("a"), blob, "세션을 저장(upsert)해도 남는다");
  assert.deepEqual(
    store.sessionsOf("u1").map(({ sid, device }) => [sid, device]),
    [["a", blob]],
  );

  store.set("b", makeSession({ id: "u1" }));
  const restore = breakDelete(store);
  store.end("b", "u1");
  restore();
  assert.ok(rowOf(store, "b"), "삭제하지 못해 행이 남았다");
  assert.equal(store.saveDevice("b", blob), false, "끝낸 세션");
  store.set("c", makeSession({ id: "u1" }));
  store.saveDevice("c", blob);
  store.destroy("c");
  assert.equal(store.readDevice("c"), null, "세션 행과 함께 지워진다");

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5_000 });
  assert.equal(store.saveDevice("a", Buffer.from("새것")), false, "만료된 행");
  store.prune();
  assert.equal(store.readDevice("a"), null, "정리할 때도 함께 지워진다");
});

test("읽은 세션의 쿠키 만료는 행의 만료(touch가 늘린 값)다. 바꾸지 않고 쓰기만 한 세션이 저장 때의 만료에 묶이지 않는다", async () => {
  const store = makeStore("expires.db");
  const session = makeSession({ id: "u1" }, DAY);
  store.set("sid1", session);
  const later = makeSession({ id: "u1" }, 6 * DAY, session.loginAt);
  store.touch("sid1", later);
  const loaded = await getAsync(store, "sid1");
  assert.equal(new Date(loaded!.cookie.expires!).getTime(), rowOf(store, "sid1")?.expires_at);
  assert.equal(new Date(store.liveSession("sid1")!.cookie.expires!).getTime(), rowOf(store, "sid1")?.expires_at, "liveSession도 같다");
  assert.ok(new Date(loaded!.cookie.expires!).getTime() > Date.now() + 5 * DAY);
});
