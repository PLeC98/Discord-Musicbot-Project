"use strict";

// src/autoplay/assist/googleAuth.js — 서비스 계정 JSON → 액세스 토큰.
//
// 이 파일이 다루는 private_key 는 이 기능에서 가장 값비싼 비밀이다.
// 어떤 경로로도 밖으로 나가지 않는 것이 여기서 지킬 계약이다.

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../../src/autoplay/assist/googleAuth");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-sa-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

// 진짜 키로 서명해야 crypto 가 통과한다 — 작게 뽑는다
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const ACCOUNT = { type: "service_account", project_id: "내-프로젝트", client_email: "bot@내-프로젝트.iam.gserviceaccount.com", private_key: privateKey };
const SA_FILE = path.join(DIR, "vertex-sa.json");
fs.writeFileSync(SA_FILE, JSON.stringify(ACCOUNT));

const realFetch = global.fetch;
after(() => {
  global.fetch = realFetch;
});

const calls = [];
function answers(reply) {
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: String(init.body) });
    return typeof reply === "function" ? reply() : { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
}

test("JWT 로 토큰을 받아 온다", async () => {
  auth._reset();
  calls.length = 0;
  answers({ access_token: "ya29.토큰", expires_in: 3600 });

  assert.equal(await auth.accessToken(SA_FILE), "ya29.토큰");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");

  // 보낸 것은 서명한 JWT 다. private_key 자체는 절대 안 나간다.
  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.ok(!calls[0].body.includes("PRIVATE KEY"), "키가 그대로 실리면 안 된다");

  const [head, claims] = sent.get("assertion").split(".");
  assert.equal(JSON.parse(Buffer.from(head, "base64url")).alg, "RS256");
  const parsed = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(parsed.iss, ACCOUNT.client_email);
  assert.equal(parsed.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.ok(parsed.exp > parsed.iat);
});

// 한 시간짜리다. 판정마다 새로 받으면 그것만으로도 느려진다.
test("받아 둔 토큰을 다시 쓴다", async () => {
  auth._reset();
  calls.length = 0;
  answers({ access_token: "ya29.한번만", expires_in: 3600 });

  await auth.accessToken(SA_FILE);
  await auth.accessToken(SA_FILE);
  await auth.accessToken(SA_FILE);
  assert.equal(calls.length, 1, "세 번 불러도 토큰은 한 번만 받는다");
});

test("곧 만료될 토큰은 새로 받는다", async () => {
  auth._reset();
  calls.length = 0;
  answers({ access_token: "ya29.곧죽음", expires_in: 30 });

  await auth.accessToken(SA_FILE);
  await auth.accessToken(SA_FILE);
  assert.equal(calls.length, 2, "만료 직전이면 다시 받는다");
});

test("JSON 을 통째로 적어도 받는다", async () => {
  auth._reset();
  answers({ access_token: "ya29.인라인", expires_in: 3600 });
  assert.equal(await auth.accessToken(JSON.stringify(ACCOUNT)), "ya29.인라인");
});

test("프로젝트는 JSON 에서 끌어온다", () => {
  assert.equal(auth.projectOf(SA_FILE), "내-프로젝트");
  assert.equal(auth.projectOf(path.join(DIR, "없는파일.json")), "", "없으면 빈 값 — 던지지 않는다");
});

// ── 오류에 비밀이 섞이지 않는가 ───────────────────────────────────────────

test("어떤 오류에도 private_key 가 나오지 않는다", async () => {
  auth._reset();

  const broken = path.join(DIR, "broken-sa.json");
  fs.writeFileSync(broken, JSON.stringify({ ...ACCOUNT, private_key: "-----BEGIN PRIVATE KEY-----\n망가진키\n-----END PRIVATE KEY-----\n" }));

  const said = [];
  for (const where of [broken, JSON.stringify({ ...ACCOUNT, private_key: undefined }), "{깨진 JSON", path.join(DIR, "없다.json")]) {
    answers({ access_token: "x", expires_in: 3600 });
    await assert.rejects(
      () => auth.accessToken(where),
      (error) => {
        said.push(error.message);
        return true;
      },
    );
  }

  // 저쪽이 거절하면서 우리가 보낸 것을 되비추는 경우까지
  answers(() => ({ ok: false, status: 401, text: async () => "invalid_grant" }));
  await assert.rejects(
    () => auth.accessToken(SA_FILE),
    (error) => {
      said.push(error.message);
      return /401/.test(error.message);
    },
  );

  assert.ok(said.length >= 5, "무엇이 잘못됐는지는 말해 줘야 한다");
  for (const line of said) {
    assert.ok(!line.includes("PRIVATE KEY"), `오류에 키가 남았다: ${line}`);
    assert.ok(!line.includes(privateKey.slice(40, 90)), `오류에 키 조각이 남았다: ${line}`);
  }
});
