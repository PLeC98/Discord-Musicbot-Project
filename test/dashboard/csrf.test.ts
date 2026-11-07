// src/dashboard/middleware/csrf.ts: 로그인한 세션에만 CSRF 토큰을 발급하고, 안전하지 않은 메서드는 그 토큰이 있어야 지나간다

import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { issueCsrfToken, requireCsrfToken } from "../../src/dashboard/middleware/csrf.ts";
import { fake, fakeWith } from "../helpers/fake.ts";
import { sessionCookieName } from "../../src/dashboard/cookies.ts";

type Body = { csrfToken?: string; code?: string };

// 응답은 보낸 상태, 헤더, 본문을 모은다. 본문은 테스트만 읽는 필드라 이름을 달리한다
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
    type(value: string) {
      this.sentHeaders["Content-Type"] = value;
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
    assert.equal(res.sentBody?.code, "bad-csrf-token");
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

test("끝난 세션의 로그아웃은 그 세션 쿠키가 실렸으면 토큰 없이 지나간다(지킬 것이 없고 이 브라우저의 쿠키만 삭제한다). 쿠키가 없는 요청(교차 사이트 폼), 로그인한 세션은 토큰이 있어야 한다", () => {
  let passed = 0;
  const cookie = `${sessionCookieName(false)}=s%3Aold.sig`;
  requireCsrfToken(request({ method: "POST", path: "/auth/logout", session: {}, headers: { cookie }, get: () => undefined }), response(), () => passed++);
  assert.equal(passed, 1);
  const crossSite = response();
  requireCsrfToken(request({ method: "POST", path: "/auth/logout", session: {}, headers: {}, get: () => undefined }), crossSite, () => passed++);
  assert.equal(passed, 1, "교차 사이트 POST는 lax 쿠키를 싣지 못한다. 받으면 다른 사이트가 이 브라우저의 쿠키를 삭제하게 된다");
  assert.equal(crossSite.sentBody?.code, "bad-csrf-token");
  const res = response();
  requireCsrfToken(request({ method: "POST", path: "/auth/logout", session: { user: { id: "u1" }, csrfToken: "t" }, headers: { cookie }, get: () => undefined }), res, () => passed++);
  assert.equal(passed, 1);
  assert.equal(res.sentBody?.code, "bad-csrf-token");
  requireCsrfToken(request({ method: "POST", path: "/api/x", session: {}, headers: { cookie }, get: () => undefined }), response(), () => passed++);
  assert.equal(passed, 1, "다른 경로는 그대로 막는다");
});
