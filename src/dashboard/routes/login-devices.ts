// 로그인한 기기(설정 창 "계정"). 지금 사용자의 세션만 보이고 끊는다(세션 표에는 모든 사용자의 세션이 함께 있다).
// 끊기는 최근 로그인만, 로그아웃과 같게: 그 세션의 디스코드 토큰 폐기 요청, 서버 목록 캐시 삭제, 세션 행 삭제.
// 디스코드 토큰은 로그인마다 따로라 다른 기기의 것을 폐기해도 지금 기기의 토큰은 그대로다.
// 행을 지우지 못하면(디스크가 가득 참 등) 성공으로 답하지 않는다(sign-out-unsaved). 이 실행에서는 끊겼고 저장소가 다시 지운다

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { tokenStoreOf, type SqliteSessionStore } from "../session-store.ts";
import { describe, handleOf, type Locate } from "../login-devices.ts";
import { revokeToken } from "./auth.ts";
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

  // 세션을 끊는다. 끝까지 해 본다(토큰 폐기는 기다리지 않는다. 토큰을 읽지 못해도 세션은 끊는다). 행을 지웠으면 true
  function signOut(store: SqliteSessionStore, sid: string, userId: string) {
    try {
      const token = store.readDiscordToken(sid);
      if (token) bestEffort(log, revokeToken(http, token), "다른 기기의 디스코드 토큰 폐기");
    } catch (error) {
      log.warn(`다른 기기의 디스코드 토큰을 읽지 못해 폐기를 요청하지 않았습니다(세션은 끊습니다): ${messageOf(error)}`);
    }
    forgetGuilds(sid);
    return store.end(sid, userId);
  }

  // 끊은 결과로 답한다. 하나라도 지우지 못했으면 성공으로 답하지 않는다
  function answer(res: express.Response, results: boolean[]) {
    const unsaved = results.filter((ok) => !ok).length;
    if (unsaved) return sendProblem(res, "sign-out-unsaved", {}, { signedOutCount: results.length - unsaved, unsavedCount: unsaved });
    res.json({ count: results.length } satisfies SignedOut);
  }

  // 최근 활동 순, 지금 기기가 맨 앞. 지금 기기는 이 요청이 고친 세션(저장은 답한 뒤)으로
  router.get("/", requireAuth, async (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const geoip = await places.load();
    const locate: Locate = geoip ? places.locate : () => null;
    const rows = store.sessionsOf(signedIn(req).id).map(({ sid, session }) => describe(sid, sid === req.sessionID ? req.session : session, req.sessionID, locate));
    rows.sort((a, b) => Number(b.current) - Number(a.current) || (b.seenAt ?? 0) - (a.seenAt ?? 0));
    res.json({ devices: rows, geoip } satisfies LoginDevices);
  });

  // 기기 하나. 지금 기기는 여기서 끊지 않는다(로그아웃으로)
  router.delete("/:id", requireAuth, requireRecentLogin, (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const user = signedIn(req);
    const target = store.sessionsOf(user.id).find(({ sid }) => sid !== req.sessionID && handleOf(sid) === req.params.id);
    if (!target) return sendProblem(res, "device-not-found");
    const results = [signOut(store, target.sid, user.id)];
    log.info(`다른 기기 로그아웃: 1곳. 실행 ${user.username || user.id}`);
    answer(res, results);
  });

  // 지금 기기 말고 모두
  router.post("/sign-out-others", requireAuth, requireRecentLogin, (req, res) => {
    const store = tokenStoreOf(req);
    if (!store) return sendProblem(res, "unknown-error");
    const user = signedIn(req);
    // 지난번에 지우지 못한 것도 다시 지운다(이 실행에서는 이미 끊겨 목록에 없다)
    const others = new Set([...store.sessionsOf(user.id).map(({ sid }) => sid), ...store.unsavedOf(user.id)]);
    others.delete(req.sessionID);
    const results = [...others].map((sid) => signOut(store, sid, user.id));
    if (others.size) log.info(`다른 기기 로그아웃: ${others.size}곳. 실행 ${user.username || user.id}`);
    answer(res, results);
  });

  return router;
}

export { createLoginDevicesRouter };
