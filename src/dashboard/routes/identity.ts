// 누구인가. 지금 로그인한 사용자(/api/me)와, 로그인 전 화면이 쓰는 봇의 공개 정보(/api/bot)

import express from "express";
import config from "../../config/index.ts";
import { isRealOwner } from "../owner.ts";
import { getViewAs, isOwner } from "../view-as.ts";
import type { BotInfo, Me } from "../contract/identity.ts";
import { avatarUrl } from "../images.ts";
import { faviconVersion } from "../appearance.ts";
import { canInvite } from "../invite.ts";
import { sendProblem } from "../problem.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import { recentLogin, RECENT_LOGIN_MS } from "../middleware/recent-login.ts";

const identityRouter = express.Router();

// isOwner는 세션에 저장하지 않고 여기서 파생한다. UI 표시용이고 권한 판정은 서버가 매번 다시 한다.
// isOwner는 권한 수준 오버라이드가 반영된 값(UI가 그 계층으로 보이게), isRealOwner는 해제 수단을
// 계속 노출하기 위한 원래 값이다.
identityRouter.get("/me", (req, res) => {
  if (!req.session.user) return sendProblem(res, "login-required");
  // 세션 사용자를 펼치지 않고 필드를 골라 보낸다(세션에 무엇이 더 붙어도 화면으로 새지 않게)
  const { id, username, globalName, avatar } = req.session.user;
  const me: Me = { id, username, globalName, avatar, avatarUrl: avatarUrl(id, avatar), isOwner: isOwner(req), isRealOwner: isRealOwner(req), viewAs: getViewAs(req), canInvite: canInvite(req.app.locals.bot.client, id) };
  res.json(me);
});

// 최근 로그인인지(204). 화면이 위험한 조작의 확인 창을 열기 전에 확인한다: 오래됐으면 reauth-required 로 로그인 창을 먼저 열고, 확인 창은 로그인을 마친 뒤에 연다.
// 로그인만 본다(다른 기기 로그아웃은 누구나 한다). within: 그 조작이 받는 시간(ms). 기본보다 길게는 받지 않는다(확인일 뿐, 막는 것은 조작의 경로다)
identityRouter.get("/me/recent-login", requireAuth, (req, res) => {
  const asked = Number(req.query.within);
  const within = Number.isFinite(asked) && asked > 0 ? Math.min(asked, RECENT_LOGIN_MS) : RECENT_LOGIN_MS;
  recentLogin(within)(req, res, () => res.status(204).end());
});

// 소스 저장소(AGPL 13조 고지)는 봇 준비와 무관하게 늘 준다. 이름, 프로필 이미지는 준비 전이면 null.
// 봇 프로필 이미지는 크게 받는다: 로그인 화면이 배경으로도 깐다(디스코드는 저장된 원본보다 크게 늘리지 않는다). 화면 곳곳이 같은 주소라 한 번 받는다
identityRouter.get("/bot", (req, res) => {
  const botUser = req.app.locals.bot.client.user;
  res.json({
    name: botUser?.username ?? null,
    avatarUrl: botUser?.avatarURL({ size: 1024, extension: "webp" }) || null,
    sourceRepo: config.bot.sourceRepo, // AGPL 소스 공개 (개조본 = SOURCE_REPO_URL, 미설정 시 projectRepo)
    projectRepo: config.bot.projectRepo, // 원본 프로젝트 저장소
    brandColor: config.bot.embedColor,
    faviconVersion: faviconVersion(),
  } satisfies BotInfo);
});

export { identityRouter };
