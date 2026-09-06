"use strict";

const { checkControl } = require("../../../src/permissions");
const S = require("../../../src/strings");

// Discord 쪽 오류 문자열(❌ 접두)을 대시보드 JSON용으로 정리
const toApiError = S.withoutErrorMark;

// 세션 사용자를 실제 길드 멤버로 해석 — 세션에 캐시된 길드 목록 대신 실멤버십 기준.
// 실패 시 res에 응답을 쓰고 null 반환.
async function resolveMember(req, res) {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) {
    res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });
    return null;
  }

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) {
    res.status(404).json({ error: "서버를 찾을 수 없습니다." });
    return null;
  }

  let member;
  try {
    member = await guild.members.fetch(req.session.user.id); // 캐시 우선, 미스 시에만 REST 1회
  } catch {
    res.status(403).json({ error: "서버 멤버가 아닙니다" });
    return null;
  }
  return { client, guild, member };
}

// 재생 조작 엔드포인트 공통 가드
async function requireControl(req, res, next) {
  if (req.session.user.isAdmin) return next();

  const ctx = await resolveMember(req, res);
  if (!ctx) return;

  const err = await checkControl(ctx.member);
  if (err) return res.status(403).json({ error: toApiError(err) });
  next();
}

module.exports = requireControl;
module.exports.resolveMember = resolveMember;
module.exports.toApiError = toApiError;
