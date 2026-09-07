"use strict";

const crypto = require("crypto");
const log = require("../../../src/logger").child({ category: "dashboard" });

// 오류 응답에 스택·내부 경로·의존성 버전이 실리지 않게 한다.
//
// 이 미들웨어가 없으면 Express 내부 폴백(finalhandler)이 NODE_ENV !== "production"일 때
// err.stack을 그대로 본문에 담는다. 세션 스토어 조회 실패는 인증보다 앞에서 터지므로
// 포트에 닿는 누구나 로그인 없이 그 스택을 본다.
//
// NODE_ENV 대신 미들웨어로 막는 이유: 환경 변수 하나에 노출 여부가 걸리면
// 다른 방식으로 기동했을 때 다시 샌다. 미들웨어는 환경과 무관하게 동작한다.
//
// 진단 가능성은 오류 ID로 유지한다 — 응답에는 ID만, 서버 로그에는 ID + 전체 스택.

const MSG_BAD_REQUEST = "요청 형식이 올바르지 않습니다.";
const MSG_UNAVAILABLE = "일시적으로 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
const MSG_INTERNAL = "요청을 처리하지 못했습니다.";
const MSG_NOT_FOUND = "요청한 경로를 찾을 수 없습니다.";

// 저장장치/DB 계층 장애 — 요청이 잘못된 게 아니라 지금 처리할 수 없는 상태라 503으로 낸다.
// (언마운트된 볼륨의 SQLite는 파일이 멀쩡해도 SQLITE_CORRUPT를 던진다.)
const UNAVAILABLE_CODES = new Set(["EIO", "ENOENT", "EACCES", "ENOSPC", "EBUSY", "ENXIO", "EROFS"]);

function isUnavailable(err) {
  const code = err?.code;
  if (typeof code !== "string") return false;
  return code.startsWith("SQLITE_") || UNAVAILABLE_CODES.has(code);
}

// err.message는 절대 내보내지 않는다 — "database disk image is malformed"도 내부 정보다.
function classify(err) {
  const status = err?.status ?? err?.statusCode;
  // express.json()이 잘못된 본문에 400을 붙여 던진다 — 500으로 뭉개면 안 된다.
  if (Number.isInteger(status) && status >= 400 && status < 500) return { status, message: MSG_BAD_REQUEST };
  if (isUnavailable(err)) return { status: 503, message: MSG_UNAVAILABLE };
  return { status: 500, message: MSG_INTERNAL };
}

function wantsJson(req) {
  const p = req.path || "";
  return p.startsWith("/api") || p.startsWith("/auth");
}

// 등록되지 않은 /api·/auth 경로. Express 기본 404는 HTML이라 클라이언트의
// e.response?.data?.error가 읽지 못해 사용자에게는 그냥 실패한 것처럼 보인다.
// 404에는 오류 객체가 없어 오류 미들웨어가 돌지 않으므로 별도 폴백이 필요하다.
function notFoundJson(req, res, next) {
  if (!wantsJson(req)) return next();
  res.status(404).json({ error: MSG_NOT_FOUND });
}

function errorHandler(err, req, res, next) {
  // SSE처럼 헤더가 이미 나간 응답에 다시 쓰면 ERR_HTTP_HEADERS_SENT로 사고가 커진다.
  if (res.headersSent) return next(err);

  const errorId = crypto.randomBytes(4).toString("hex");
  const { status, message } = classify(err);

  log.error(`[${errorId}] ${req.method} ${req.originalUrl} → ${status}`, err?.stack || err?.message || err);

  res.status(status);
  if (wantsJson(req)) return res.json({ error: message, errorId });
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>${status}</title><h1>${status}</h1><p>${message}</p><p>오류 ID: ${errorId}</p>`);
}

module.exports = { errorHandler, notFoundJson, _internals: { classify, isUnavailable } };
