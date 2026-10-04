// 누구인가. 지금 로그인한 사람(/api/me)과, 로그인 전 화면이 쓰는 봇의 공개 정보(/api/bot)

import express from "express";
import config from "../../config/index.ts";
import { isOwner, isRealOwner } from "../owner.ts";
import { getViewAs } from "../view-as.ts";
import type { BotInfo, Me } from "../contract/identity.ts";
import { sendProblem } from "../problem.ts";

const identityRouter = express.Router();

// isOwner는 세션에 저장하지 않고 여기서 파생한다. UI 표시용이고 권한 판정은 서버가 매번 다시 한다.
// isOwner는 권한 수준 오버라이드가 반영된 값(UI가 그 계층으로 보이게), isRealOwner는 해제 수단을
// 계속 노출하기 위한 원래 값이다.
identityRouter.get("/me", (req, res) => {
  if (!req.session.user) return sendProblem(res, "login-required");
  res.json({ ...req.session.user, isOwner: isOwner(req), isRealOwner: isRealOwner(req), viewAs: getViewAs(req) } satisfies Me);
});

// 소스 저장소(AGPL 13조 고지)는 봇 준비와 무관하게 늘 준다. 이름 · 그림은 준비 전이면 null
identityRouter.get("/bot", (req, res) => {
  const botUser = req.app.locals.bot.client.user;
  res.json({
    name: botUser?.username ?? null,
    avatarUrl: botUser?.avatarURL({ size: 256, extension: "webp" }) || null,
    sourceRepo: config.bot.sourceRepo, // AGPL 소스 공개 (개조본 = SOURCE_REPO_URL, 미설정 시 projectRepo)
    projectRepo: config.bot.projectRepo, // 원본 프로젝트 저장소
  } satisfies BotInfo);
});

export { identityRouter };
