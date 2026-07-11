"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const { issueCsrfToken, requireCsrfToken, csrfTokensEqual } = require("../dashboard/server/middleware/csrf");

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("issues and reuses a CSRF token for an authenticated session", () => {
  const req = { session: { user: { id: "1" } } };
  const first = response();
  const second = response();

  issueCsrfToken(req, first);
  issueCsrfToken(req, second);

  assert.match(first.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(second.body.csrfToken, first.body.csrfToken);
  assert.equal(first.headers["Cache-Control"], "no-store");
});

test("does not issue a CSRF token without an authenticated session", () => {
  const res = response();
  issueCsrfToken({ session: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("allows safe methods without a token", () => {
  let called = false;
  requireCsrfToken({ method: "GET" }, response(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test("rejects unsafe methods with a missing or incorrect token", () => {
  for (const supplied of [undefined, "wrong", "expectec"]) {
    const res = response();
    let called = false;
    requireCsrfToken(
      {
        method: "POST",
        session: { csrfToken: "expected" },
        get: () => supplied,
      },
      res,
      () => {
        called = true;
      },
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "INVALID_CSRF_TOKEN");
  }
});

test("allows unsafe methods with the session CSRF token", () => {
  let called = false;
  requireCsrfToken(
    {
      method: "DELETE",
      session: { csrfToken: "expected" },
      get: () => "expected",
    },
    response(),
    () => {
      called = true;
    },
  );
  assert.equal(called, true);
});

test("compares equal-length CSRF tokens without accepting a mismatch", () => {
  assert.equal(csrfTokensEqual("expected", "expected"), true);
  assert.equal(csrfTokensEqual("expected", "expectec"), false);
  assert.equal(csrfTokensEqual(undefined, "expected"), false);
});

test("protects unsafe Express routes with a session-bound token", async (t) => {
  const app = express();
  app.use(
    session({
      secret: "test-only-session-secret-at-least-32-bytes",
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use((req, _res, next) => {
    req.session.user = { id: "1" };
    next();
  });
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(requireCsrfToken);
  app.post("/api/change", (_req, res) => res.status(204).end());

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenResponse = await fetch(`${base}/api/csrf-token`);
  assert.equal(tokenResponse.status, 200);
  const cookie = tokenResponse.headers.get("set-cookie").split(";", 1)[0];
  const { csrfToken } = await tokenResponse.json();

  const request = (token) =>
    fetch(`${base}/api/change`, {
      method: "POST",
      headers: {
        cookie,
        ...(token === undefined ? {} : { "x-csrf-token": token }),
      },
    });

  let response = await request();
  assert.equal(response.status, 403);

  const wrongToken = `${csrfToken.slice(0, -1)}${csrfToken.endsWith("A") ? "B" : "A"}`;
  response = await request(wrongToken);
  assert.equal(response.status, 403);

  response = await request(csrfToken);
  assert.equal(response.status, 204);
});
