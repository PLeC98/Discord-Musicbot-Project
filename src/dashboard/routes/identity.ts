// 누구인가. 지금 로그인한 사람(/api/me)과, 로그인 전 화면이 쓰는 봇의 공개 정보(/api/bot)

import express from "express";
import config from "../../config/index.ts";
import { isOwner, isRealOwner } from "../owner.ts";
import { getViewAs } from "../view-as.ts";
import type { BotInfo, Me } from "../contract/identity.ts";
import { avatarUrl } from "../images.ts";
import { faviconVersion } from "../appearance.ts";
import { canInvite } from "../invite.ts";
import { sendProblem } from "../problem.ts";

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

// 소스 저장소(AGPL 13조 고지)는 봇 준비와 무관하게 늘 준다. 이름 · 그림은 준비 전이면 null.
// 봇 그림은 크게 받는다: 로그인 화면이 배경으로도 깐다(디스코드는 저장된 원본보다 크게 늘리지 않는다). 화면 곳곳이 같은 주소라 한 번 받는다
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
