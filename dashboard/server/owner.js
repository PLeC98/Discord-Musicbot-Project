"use strict";

const config = require("../../config");

/**
 * 봇 운영자(`OWNER_ID`) 여부를 요청마다 현재 설정으로 다시 판정한다.
 * 길드의 "서버 관리" 권한과는 다른 개념이다 — 그쪽은 `isModerator` / `canManageGuild`.
 *
 * 로그인 시점 값을 세션에 굳혀두면 `OWNER_ID`를 바꿔도 기존 세션의 권한이 철회되지 않는다.
 * 세션은 SQLite에 남고 쿠키 수명이 7일이라, 고정 `SESSION_SECRET`이면 재시작도 견딘다.
 *
 * `OWNER_ID` 미설정이면 아무도 운영자가 아니다 — 양쪽이 `undefined`로 일치하는 일이 없게.
 */
function isOwner(req) {
  const ownerId = config.dashboard.ownerId;
  return !!ownerId && req?.session?.user?.id === ownerId;
}

module.exports = { isOwner };
