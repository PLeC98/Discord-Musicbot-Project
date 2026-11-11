// 로그인한 기기(설정 창 "계정"). 지금 사용자의 세션만 보이고 끊는다(세션 표에는 모든 사용자의 세션이 함께 있다).
// 끊기는 최근 로그인만, 로그아웃과 같게: 그 세션의 디스코드 토큰 폐기 요청, 서버 목록 캐시 삭제, 세션 행 삭제.
// 디스코드 토큰은 로그인마다 따로라 다른 기기의 것을 폐기해도 지금 기기의 토큰은 그대로다.
// 행을 삭제하지 못하면(디스크가 가득 참 등) 성공으로 답하지 않는다(sign-out-unsaved). 이 실행에서는 끊겼고 저장소가 다시 삭제한다.
// "다른 기기 모두"는 이 기기도 새 세션 id로 옮긴다: 이 기기의 쿠키를 복사해 간 쪽은 이 기기와 같은 세션 id라 목록에 따로 보이지 않는다

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { recentLogin } from "../middleware/recent-login.ts";
import { SIGN_OUT_LOGIN_MS } from "../contract/identity.ts";
import { tokenStoreOf, type SqliteSessionStore } from "../session-store.ts";
import { describe, handleOf, type Locate } from "../login-devices.ts";
import { revokeToken, startSession } from "./auth.ts";
import { forgetGuilds } from "../user-guilds.ts";
import { discordHttp, type DiscordHttp } from "../discord-api.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import { sendProblem } from "../problem.ts";
import { messageOf } from "../../rules/error-kind.ts";
import type { LoginDevices, SignedOut } from "../contract/identity.ts";

/** IP 위치(dashboard/geoip). load: 목록을 그리기 전에 올린다(쓸 수 있으면 true, 화면이 출처 링크를 단다). locate: 공인 주소만 조회한다 */
type Places = { load(): Promise<boolean>; locate: Locate };

/** http: 디스코드(토큰 폐기) */
function createLoginDevicesRouter({ places, http = discordHttp }: { places: Places; http?: DiscordHttp }) {
  const router = express.Router();

  // 세션을 끊는다. 끝까지 해 본다(토큰 폐기는 기다리지 않는다. 토큰을 읽지 못해도 세션은 끊는다). 행을 삭제했으면 true
  function signOut(store: SqliteSessionStore, sid: string, userId: string) {
    try {
      const token = store.readDiscordToken(sid);
      if (token) bestEffort(log, revokeToken(http, token), "다른 기기의 디스코드 토큰 폐기", "warn");
    } catch (error) {
      log.warn(`다른 기기의 디스코드 토큰 읽기 실패(폐기 요청 생략, 세션은 끊음): ${messageOf(error)}`);
    }
    forgetGuilds(sid);
    return store.end(sid, userId);
  }

  // 끊은 결과로 답한다(count는 이번에 끊은 기기). 하나라도 삭제하지 못했으면(지난번 것을 다시 삭제하기 포함) 성공으로 답하지 않는다
  function answer(res: express.Response, results: boolean[], retried: boolean[] = []) {
    const unsaved = [...results, ...retried].filter((ok) => !ok).length;
    if (unsaved) return sendProblem(res, "sign-out-unsaved", {}, { signedOutCount: results.filter(Boolean).length, unsavedCount: unsaved });
    res.json({ count: results.length } satisfies SignedOut);
  }

  // 최근 활동순, 현재 기기가 맨 앞. 현재 기기의 기록은 이 요청에서 noteDevice가 이미 갱신했다
  router.get("/", requireAuth, async (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const geoip = await places.load();
    const locate: Locate = geoip ? places.locate : () => null;
    const rows = store.sessionsOf(signedIn(req).id).map(({ sid, session, device }) => describe(sid, session, device, req.sessionID, locate));
    rows.sort((a, b) => Number(b.current) - Number(a.current) || (b.seenAt ?? 0) - (a.seenAt ?? 0));
    res.json({ devices: rows, geoip } satisfies LoginDevices);
  });

  // 기기 하나. 지금 기기는 여기서 끊지 않는다(로그아웃으로)
  // 끊기는 로그인한 지 2분 안(거의 언제나 로그인 창을 거쳐 이 기기의 세션 id도 바뀐다. 이 기기의 쿠키를 복제한 쪽도 끊긴다)
  const signOutLogin = recentLogin(SIGN_OUT_LOGIN_MS);

  router.delete("/:id", requireAuth, signOutLogin, (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const user = signedIn(req);
    const target = store.sessionsOf(user.id).find(({ sid }) => sid !== req.sessionID && handleOf(sid) === req.params.id);
    if (!target) return sendProblem(res, "device-not-found");
    const results = [signOut(store, target.sid, user.id)];
    log.info(`다른 기기 로그아웃: 1곳. 실행 ${user.username || user.id}`);
    answer(res, results);
  });

  // 이 기기의 디스코드 토큰. 이전 세션 행이 지워지기 전에 읽어 새 세션 id로 옮긴다. 읽지 못하면 옮기지 않는다(서버 목록이 다시 로그인을 안내한다)
  function tokenOf(store: SqliteSessionStore, sid: string) {
    try {
      return store.readDiscordToken(sid);
    } catch (error) {
      log.warn(`이 기기의 디스코드 토큰 읽기 실패(새 세션에 옮기지 않음): ${messageOf(error)}`);
      return null;
    }
  }

  // 지금 기기 말고 모두. 이 기기도 새 세션 id로 옮긴다(로그인 시각, view-as, 디스코드 토큰, 기기 기록은 그대로, CSRF 토큰은 새로)
  router.post("/sign-out-others", requireAuth, signOutLogin, async (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const user = signedIn(req);
    // 지난번에 삭제하지 못한 것(이 실행에서는 이미 끊겨 목록에 없고 토큰 폐기도 했다). 이번에 끊는 것보다 먼저 구해 둔다(이번 실패를 두 번 세지 않게)
    const retried = store.unsavedOf(user.id).filter((sid) => sid !== req.sessionID);
    const others = store.sessionsOf(user.id).filter(({ sid }) => sid !== req.sessionID);
    const results = others.map(({ sid }) => signOut(store, sid, user.id));
    if (others.length) log.info(`다른 기기 로그아웃: ${others.length}곳. 실행 ${user.username || user.id}`);
    const retriedResults = retried.map((sid) => store.end(sid, user.id));
    const oldSid = req.sessionID;
    // 최근 로그인 확인을 지났으니 있다. 없으면 0(새 세션은 절대 기한이 지나 곧바로 끝난다). 기기 기록의 로그인 시각도 이것이다
    const loginAt = req.session.loginAt ?? 0;
    const moved = await startSession(req, { user, loginAt, viewAs: req.session.viewAs, token: tokenOf(store, oldSid), signedInAt: loginAt, failure: "다른 기기 로그아웃 뒤 이 기기의 새 세션 저장 실패(이 기기도 로그아웃)" });
    // 이전 세션 행을 지우지 못했으면 다른 기기와 같게 성공으로 답하지 않는다. 새 세션을 저장하지 못했으면 이 기기도 로그아웃이다
    if (!moved) return store.isUnsaved(oldSid) ? answer(res, results, [...retriedResults, false]) : sendProblem(res, "login-required");
    // 여전히 삭제하지 못했으면 성공으로 답하지 않는다
    answer(res, results, retriedResults);
  });

  return router;
}

export { createLoginDevicesRouter };
