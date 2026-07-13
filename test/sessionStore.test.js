"use strict";

// dashboard/server/sessionStore.js — SQLite 세션 스토어
// 회귀 대상: MemoryStore의 재시작 시 세션 소실. 임시 DB 사용 — 운영 sessions.db 미접촉.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const SqliteSessionStore = require("../dashboard/server/sessionStore");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-sess-"));
const stores = [];

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
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const getAsync = (store, sid) => new Promise((res, rej) => store.get(sid, (e, s) => (e ? rej(e) : res(s))));

function makeSession(user, expiresInMs = 60_000) {
  return { cookie: { expires: new Date(Date.now() + expiresInMs).toISOString() }, user };
}

test("set/get 라운드트립: 세션 객체 보존", async () => {
  const store = makeStore("roundtrip.db");
  const session = makeSession({ id: "u1", username: "tester", isAdmin: false, guilds: [{ id: "g1" }] });
  store.set("sid1", session);

  const loaded = await getAsync(store, "sid1");
  assert.deepEqual(loaded, session);
  assert.equal(await getAsync(store, "sid-없음"), null);
});

test("재시작 생존: 같은 DB 파일을 다시 열어도 세션 유지 (MemoryStore 회귀)", async () => {
  const dbPath = path.join(tmpDir, "restart.db");
  const first = new SqliteSessionStore({ dbPath });
  first.set("sid1", makeSession({ id: "u1" }));
  first.close(); // 봇 재시작 시뮬레이션

  const second = new SqliteSessionStore({ dbPath });
  stores.push(second);
  const loaded = await getAsync(second, "sid1");
  assert.equal(loaded.user.id, "u1", "재시작 후에도 로그인 유지");
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

test("touch: 만료를 연장해 prune에서 생존", async () => {
  const store = makeStore("touch.db");
  store.set("sid1", makeSession({ id: "u1" }, 1_000));
  store.touch("sid1", makeSession({ id: "u1" }, 120_000));

  const realNow = Date.now;
  Date.now = () => realNow() + 60_000; // 원래 만료(1초)보다 뒤, 연장(120초) 안쪽
  try {
    assert.equal(store.prune(), 0, "연장된 세션은 정리되지 않음");
    assert.notEqual(await getAsync(store, "sid1"), null);
  } finally {
    Date.now = realNow;
  }
});

test("cookie.expires 없는 세션(브라우저 세션 쿠키)은 폴백 TTL로 보관", async () => {
  const store = makeStore("fallback.db");
  store.set("sid1", { cookie: {}, user: { id: "u1" } });
  assert.notEqual(await getAsync(store, "sid1"), null, "즉시 만료되지 않음");
  assert.equal(store.prune(), 0);
});
