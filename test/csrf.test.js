"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { issueCsrfToken, requireCsrfToken } = require("../dashboard/server/middleware/csrf");

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
  for (const supplied of [undefined, "wrong"]) {
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
