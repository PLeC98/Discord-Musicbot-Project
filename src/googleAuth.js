"use strict";

// 구글 서비스 계정 → 액세스 토큰.
//
// 버텍스 AI 는 API 키를 안 받는다. 서비스 계정 JSON 으로 JWT 를 만들어 서명하고,
// 그것을 구글 토큰 엔드포인트에 내밀어 한 시간짜리 액세스 토큰을 받아 쓴다.
//
// 이 파일이 다루는 것은 이 기능에서 가장 값비싼 비밀이다. private_key 는 어떤 경로로도
// 밖으로 나가면 안 된다 — 오류 메시지에도, 로그에도, 화면에도.
// 그래서 여기서 던지는 오류는 우리가 쓴 문구뿐이고, 저쪽 응답은 본문 앞머리만 싣는다.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const LIFETIME_SEC = 3600;
// 만료 직전에 쓰면 요청이 가는 사이에 죽는다. 조금 일찍 새로 받는다.
const EARLY_MS = 60_000;

const b64url = (input) => Buffer.from(input).toString("base64url");

/**
 * 서비스 계정 JSON 을 읽는다. 파일 경로로 적는 것이 보통이고, 통째로 적어도 받는다.
 * @param {string} where 경로 또는 JSON 글
 */
function readAccount(where, baseDir) {
  const raw = String(where || "").trim();
  if (!raw) throw new Error("서비스 계정이 설정돼 있지 않습니다");

  let text = raw;
  if (!raw.startsWith("{")) {
    const file = path.isAbsolute(raw) ? raw : path.join(baseDir || process.cwd(), raw);
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      // 경로는 비밀이 아니다. 어디를 봤는지 알려 주지 않으면 고칠 수가 없다.
      throw new Error(`서비스 계정 파일을 읽지 못했습니다: ${file}`);
    }
  }

  let account;
  try {
    account = JSON.parse(text);
  } catch {
    throw new Error("서비스 계정 JSON 을 읽지 못했습니다(형식이 깨졌습니다)");
  }

  if (!account?.client_email || !account?.private_key) throw new Error("서비스 계정 JSON 에 client_email 또는 private_key 가 없습니다");
  return account;
}

// client_email -> { token, expiresAt }
const cache = new Map();

/**
 * 액세스 토큰을 받는다. 한 시간짜리라 받아 두고 만료 직전까지 그대로 쓴다.
 * @returns {Promise<string>}
 */
async function accessToken(where, { baseDir, timeoutMs = 15000 } = {}) {
  const account = readAccount(where, baseDir);

  const held = cache.get(account.client_email);
  if (held && held.expiresAt - EARLY_MS > Date.now()) return held.token;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri || TOKEN_URL,
    iat: now,
    exp: now + LIFETIME_SEC,
  };

  const signing = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(signing).sign(account.private_key, "base64url");
  } catch {
    // 오류에 키가 섞여 나올 수 있다 — 저쪽 문구를 그대로 싣지 않는다
    throw new Error("서비스 계정 키로 서명하지 못했습니다(private_key 를 확인하세요)");
  }

  const res = await fetch(account.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${signing}.${signature}` }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`토큰을 받지 못했습니다: HTTP ${res.status} — ${text.slice(0, 200)}`);

  let token;
  try {
    token = JSON.parse(text);
  } catch {
    throw new Error("토큰 응답을 읽지 못했습니다");
  }
  if (!token?.access_token) throw new Error("토큰 응답에 access_token 이 없습니다");

  cache.set(account.client_email, {
    token: token.access_token,
    expiresAt: Date.now() + (Number(token.expires_in) || LIFETIME_SEC) * 1000,
  });
  return token.access_token;
}

/** 이 서비스 계정의 프로젝트(설정에 안 적었으면 JSON 것을 쓴다). */
function projectOf(where, baseDir) {
  try {
    return readAccount(where, baseDir).project_id || "";
  } catch {
    return "";
  }
}

/** 받아 둔 토큰 — 가려야 할 것이라 바깥에서도 알아야 한다(autoplayAssist.mask). */
const heldTokens = () => [...cache.values()].map((one) => one.token).filter(Boolean);

module.exports = { accessToken, projectOf, heldTokens, readAccount, _reset: () => cache.clear() };
