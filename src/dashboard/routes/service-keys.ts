// 바깥 서비스 키(운영자 패널의 API 키 탭). /api/admin/service-keys
// 값은 쓰기만 한다. 어느 응답으로도 내려가지 않고 상태(저장 여부, 끝 네 글자, 바꾼 때)만 간다.
// 입력, 삭제는 로그인한 지 10분 안이어야 한다(middleware/recent-login). 연결 테스트는 저장된 키를 그 서비스에만 보내므로 최근 로그인을 보지 않는다

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, errorProblem, messageOf } from "../../rules/error-kind.ts";
import { isServiceId, type KeyCheck, type ServiceId } from "../../rules/service-keys.ts";
import * as serviceKeys from "../../store/service-keys.ts";
import { checkCredentials as checkSpotify } from "../../sources/spotify.ts";
import { checkLastfmKey } from "../../autoplay/sources/lastfm.ts";
import { checkListenbrainzToken } from "../../autoplay/sources/lbradio.ts";
import { L } from "../../infra/log/text.ts";

const CHECKS: Record<ServiceId, () => Promise<KeyCheck>> = { spotify: checkSpotify, lastfm: checkLastfmKey, listenbrainz: checkListenbrainzToken };

const serviceKeysRouter = express.Router();
serviceKeysRouter.use(requireOwner);

serviceKeysRouter.get("/", (_req, res) => res.json(serviceKeys.view()));

serviceKeysRouter.put("/:service", requireRecentLogin, (req, res) => {
  const { service } = req.params;
  const values: unknown = req.body?.values;
  if (!isServiceId(service) || !values || typeof values !== "object") return sendProblem(res, "nothing-to-save");
  try {
    serviceKeys.save(service, values as Record<string, unknown>);
  } catch (error) {
    if (codeOf(error) === "SECRET_INVALID") return sendProblem(res, "nothing-to-save");
    log.error({ sub: "admin" }, L.dashboard.serviceKeySaveFailed({ service: serviceKeys.LABELS[service], error: messageOf(error) }));
    return sendProblem(res, "config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: errorProblem(error) }] });
  }
  log.warn({ sub: "admin" }, L.dashboard.serviceKeySaved({ service: serviceKeys.LABELS[service], fields: Object.keys(values).join(", "), by: ranBy(req) }));
  res.json(serviceKeys.view());
});

serviceKeysRouter.delete("/:service", requireRecentLogin, (req, res) => {
  const { service } = req.params;
  if (!isServiceId(service)) return sendProblem(res, "nothing-to-save");
  serviceKeys.remove(service);
  log.warn({ sub: "admin" }, L.dashboard.serviceKeyRemoved({ service: serviceKeys.LABELS[service], by: ranBy(req) }));
  res.json(serviceKeys.view());
});

serviceKeysRouter.post("/:service/test", async (req, res) => {
  const { service } = req.params;
  if (!isServiceId(service)) return sendProblem(res, "nothing-to-save");
  res.json(await CHECKS[service]());
});

export { serviceKeysRouter };
