import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { issueCsrfToken, requireCsrfToken } from "../../dashboard/server/middleware/csrf.ts";
import { fake, fakeWith } from "../helpers/fake.ts";

type Body = { csrfToken?: string; code?: string };

// 응답은 보낸 상태 · 헤더 · 본문을 모은다. 본문은 시험만 읽는 칸이라 이름을 달리한다
function response() {
  return fakeWith<Response>()({
    statusCode: 200,
    sentBody: null as Body | null,
    sentHeaders: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      this.sentHeaders[name] = value;
      return this;
    },
    json(body: Body) {
      this.sentBody = body;
      return this;
    },
  });
}

const request = (fields: object) => fake<Request>(fields);

test("issues and reuses a CSRF token for an authenticated session", () => {
  const req = request({ session: { user: { id: "1" } } });
  const first = response();
  const second = response();

  issueCsrfToken(req, first);
  issueCsrfToken(req, second);

  assert.match(first.sentBody?.csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(second.sentBody?.csrfToken, first.sentBody?.csrfToken);
  assert.equal(first.sentHeaders["Cache-Control"], "no-store");
});

test("does not issue a CSRF token without an authenticated session", () => {
  const res = response();
  issueCsrfToken(request({ session: {} }), res);
  assert.equal(res.statusCode, 401);
});

test("allows safe methods without a token", () => {
  let called = false;
  requireCsrfToken(request({ method: "GET" }), response(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test("rejects unsafe methods with a missing or incorrect token", () => {
  for (const supplied of [undefined, "wrong"]) {
    const res = response();
    let called = false;
    requireCsrfToken(
      request({
        method: "POST",
        session: { csrfToken: "expected" },
        get: () => supplied,
      }),
      res,
      () => {
        called = true;
      },
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.sentBody?.code, "INVALID_CSRF_TOKEN");
  }
});

test("allows unsafe methods with the session CSRF token", () => {
  let called = false;
  requireCsrfToken(
    request({
      method: "DELETE",
      session: { csrfToken: "expected" },
      get: () => "expected",
    }),
    response(),
    () => {
      called = true;
    },
  );
  assert.equal(called, true);
});
