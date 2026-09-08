"use strict";

const config = require("../../config");
const { getViewAs } = require("./viewAs");

/**
 * 봇 운영자(`OWNER_ID`) 여부를 요청마다 현재 설정으로 다시 판정한다.
 * 디스코드 서버 쪽 권한(모더레이터·서버 관리)과는 다른 개념이다 — `isModerator`.
 *
 * 로그인 시점 값을 세션에 굳혀두면 `OWNER_ID`를 바꿔도 기존 세션의 권한이 철회되지 않는다.
 * 세션은 SQLite에 남고 쿠키 수명이 7일이라, 고정 `SESSION_SECRET`이면 재시작도 견딘다.
 *
 * `OWNER_ID` 미설정이면 아무도 운영자가 아니다 — 양쪽이 `undefined`로 일치하는 일이 없게.
 */
function isRealOwner(req) {
  const ownerId = config.dashboard.ownerId;
  return !!ownerId && req?.session?.user?.id === ownerId;
}

/**
 * 권한 판정용 운영자 여부. 권한 수준 오버라이드(viewAs)가 걸려 있으면 그 계층을 따른다.
 * 오버라이드를 켜고 끄는 경로 자체는 isRealOwner를 써야 한다 — 아니면 스스로를 잠근다.
 */
function isOwner(req) {
  if (!isRealOwner(req)) return false;
  const tier = getViewAs(req);
  return !tier || tier === "owner";
}

module.exports = { isOwner, isRealOwner };
