// 로그인한 기기. 세션마다 기기 기록(User-Agent, IP, 로그인, 마지막 활동 시각)을 두고, 설정 창 "계정"이 그 사용자의 세션들을 보이고 끊는다(routes/login-devices).
// 기록은 세션 내용 밖의 표(session_devices)에 암호화해 둔다(IP는 개인 정보이므로 store/secrets로 암호화하며, 세션 id에 묶어 두어 다른 행으로 옮기면 복호화되지 않는다).
// 세션 내용에 두면 기록을 다시 적는 요청이 세션 전체를 저장하므로, 그 요청이 오래 걸리는 사이 다른 요청이 같은 세션에서 바꾼 값(view-as 등)을 이전 사본으로 덮어쓴다.
// 마지막 활동 시각은 몇 분 간격으로만 다시 적는다

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { tokenStoreOf, type SqliteSessionStore } from "./session-store.ts";
import { UAParser } from "ua-parser-js";
import * as secrets from "../store/secrets.ts";
import { isPublicIp } from "../infra/public-address.ts";
import logger from "../infra/log/logger.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { DevicePlace, LoginDevice } from "./contract/identity.ts";
import { clientIp } from "./client-ip.ts";
const log = logger.child({ category: "dashboard" });

/** 기기 기록. ip 는 그때 요청의 주소(믿는 프록시 뒤면 실제 주소) */
type DeviceRecord = { ua: string; ip: string; signedInAt: number; seenAt: number };

const PURPOSE = "login-device";
/** 마지막 활동을 다시 적는 간격. 그 사이에도 IP, 브라우저가 바뀌면 바로 적는다 */
const SEEN_EVERY_MS = 5 * 60_000;
const sealFailure = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "로그인 기기 기록 암호화");
const storeFailure = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "로그인 기기 기록 읽기 또는 쓰기");

// 암호화하지 못하면(SECRETS_KEY 가 없는 테스트, 스크립트) 적지 않는다. 기록이 없어도 로그인, 요청은 그대로다
function seal(sid: string, record: DeviceRecord): Buffer | undefined {
  try {
    const sealed = secrets.sealBlob(PURPOSE, JSON.stringify(record), sid);
    sealFailure.ok();
    return sealed;
  } catch (error) {
    if (codeOf(error) !== "SECRETS_KEY_MISSING") sealFailure.fail(messageOf(error));
    return undefined;
  }
}

/** 암호화한 기록을 복호화한다. 없거나 복호화되지 않으면(SECRETS_KEY 가 바뀌었거나 없음, 다른 행에서 옮김) null */
function openRecord(sid: string, sealed: Buffer | null | undefined): DeviceRecord | null {
  if (!sealed) return null;
  try {
    const json = secrets.openBlob(PURPOSE, sealed, sid);
    if (!json) return null;
    const record = JSON.parse(json) as Partial<DeviceRecord>;
    return typeof record.ua === "string" && typeof record.ip === "string" && typeof record.signedInAt === "number" && typeof record.seenAt === "number" ? (record as DeviceRecord) : null;
  } catch {
    return null;
  }
}

const userAgentOf = (req: Request) => String(req.get("user-agent") ?? "").slice(0, 512);

/** 로그인할 때(세션 행을 저장한 뒤) 기기 기록을 처음 적는다. 저장소 오류는 잡지 않고 그대로 던진다 */
function recordLogin(req: Request, store: SqliteSessionStore, now = Date.now()) {
  const sealed = seal(req.sessionID, { ua: userAgentOf(req), ip: clientIp(req), signedInAt: now, seenAt: now });
  if (sealed) store.saveDevice(req.sessionID, sealed, now);
}

/**
 * 로그인한 세션의 요청마다 실행한다. 기록이 없으면 현재 요청 정보로 만들고(로그인 시각은 세션의 loginAt),
 * 마지막 활동 뒤 SEEN_EVERY_MS가 지났거나 IP, 브라우저가 바뀌었으면 다시 적는다. 세션 내용은 건드리지 않는다.
 * 기록을 다루지 않는 저장소(테스트의 메모리 저장소)면 건너뛴다. 읽기나 쓰기에 실패해도 요청은 그대로 진행한다
 */
function noteDevice(req: Request, _res: Response, next: NextFunction) {
  const store = tokenStoreOf(req);
  if (store && req.session?.user) {
    try {
      const now = Date.now();
      const ua = userAgentOf(req);
      const ip = clientIp(req);
      const was = openRecord(req.sessionID, store.readDevice(req.sessionID));
      if (!was || now - was.seenAt >= SEEN_EVERY_MS || was.ip !== ip || was.ua !== ua) {
        const sealed = seal(req.sessionID, { ua, ip, signedInAt: was?.signedInAt ?? req.session.loginAt ?? now, seenAt: now });
        if (sealed) store.saveDevice(req.sessionID, sealed, now);
      }
      storeFailure.ok();
    } catch (error) {
      storeFailure.fail(messageOf(error));
    }
  }
  next();
}

/** 세션을 가리키는 핸들. 쿠키 값이 곧 세션 id 라 그대로 내보내지 않는다. 찾을 때는 그 사용자의 세션 안에서만 비교한다 */
const handleOf = (sid: string) => crypto.createHash("sha256").update(sid).digest("base64url").slice(0, 22);

/** IP 위치를 찾는 쪽(dashboard 의 IP 위치 DB). 찾지 못하면 null */
type Locate = (ip: string) => DevicePlace;

/** 사설 주소면 내부망, 아니면 위치 DB 에서 조회한다 */
function placeOf(ip: string, locate: Locate): DevicePlace {
  if (!ip) return null;
  return isPublicIp(ip) ? locate(ip) : { kind: "private" };
}

const KINDS = new Set(["mobile", "tablet"]);

/** 화면에 보일 기기 하나. sealed: 암호화한 기기 기록(없으면 null) */
function describe(sid: string, session: Partial<SessionData>, sealed: Buffer | null, currentSid: string, locate: Locate): LoginDevice {
  const record = openRecord(sid, sealed);
  const base = { id: handleOf(sid), current: sid === currentSid };
  if (!record) return { ...base, known: false, browser: null, os: null, kind: null, signedInAt: session.loginAt ?? null, seenAt: null, place: null };
  const { browser, os, device } = new UAParser(record.ua).getResult();
  const kind = device.type && KINDS.has(device.type) ? (device.type as "mobile" | "tablet") : browser.name ? "desktop" : null;
  return { ...base, known: true, browser: browser.name ?? null, os: os.name ?? null, kind, signedInAt: record.signedInAt, seenAt: record.seenAt, place: placeOf(record.ip, locate) };
}

export { recordLogin, noteDevice, describe, handleOf, placeOf, openRecord, SEEN_EVERY_MS };
export type { DeviceRecord, Locate };
