// 로그인한 기기. 세션마다 기기 기록(User-Agent · IP · 로그인 · 마지막 활동 시각)을 두고, 설정 창 "계정"이 그 사용자의 세션들을 보이고 끊는다(routes/login-devices).
// 기록은 세션 내용(JSON)의 device 칸에 봉해 둔다(IP 는 개인 정보. store/secrets, 세션 id 에 묶어 다른 행으로 옮기면 풀리지 않는다). 표 구조는 바꾸지 않는다.
// 마지막 활동은 몇 분마다만 다시 적는다(요청마다 세션을 다시 쓰지 않는다. 그 사이는 세션 저장소의 touch 가 만료만 늘린다)

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { UAParser } from "ua-parser-js";
import * as secrets from "../store/secrets.ts";
import { isPublicIp } from "../infra/public-address.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { DevicePlace, LoginDevice } from "./contract/identity.ts";
const log = logger.child({ category: "dashboard" });

/** 기기 기록. ip 는 그때 요청의 주소(믿는 프록시 뒤면 실제 주소) */
type DeviceRecord = { ua: string; ip: string; signedInAt: number; seenAt: number };

const PURPOSE = "login-device";
/** 마지막 활동을 다시 적는 간격. 그 사이에도 IP · 브라우저가 바뀌면 바로 적는다 */
const SEEN_EVERY_MS = 5 * 60_000;

// 봉하지 못하면(SECRETS_KEY 가 없는 시험 · 스크립트) 적지 않는다. 기록이 없어도 로그인 · 요청은 그대로다
function seal(sid: string, record: DeviceRecord): string | undefined {
  try {
    return secrets.sealBlob(PURPOSE, JSON.stringify(record), sid).toString("base64");
  } catch (error) {
    if (codeOf(error) !== "SECRETS_KEY_MISSING") log.debug(`로그인 기기 기록 봉하기 실패: ${messageOf(error)}`);
    return undefined;
  }
}

/** 봉한 기록을 푼다. 없거나 풀리지 않으면(SECRETS_KEY 가 바뀌었거나 없음 · 다른 행에서 옮김) null */
function openRecord(sid: string, sealed: string | undefined): DeviceRecord | null {
  if (!sealed) return null;
  try {
    const json = secrets.openBlob(PURPOSE, Buffer.from(sealed, "base64"), sid);
    if (!json) return null;
    const record = JSON.parse(json) as Partial<DeviceRecord>;
    return typeof record.ua === "string" && typeof record.ip === "string" && typeof record.signedInAt === "number" && typeof record.seenAt === "number" ? (record as DeviceRecord) : null;
  } catch {
    return null;
  }
}

const userAgentOf = (req: Request) => String(req.get("user-agent") ?? "").slice(0, 512);

/** 로그인 때(세션을 새로 만든 뒤) 처음 적는다 */
function recordLogin(req: Request, now = Date.now()) {
  const sealed = seal(req.sessionID, { ua: userAgentOf(req), ip: req.ip ?? "", signedInAt: now, seenAt: now });
  if (sealed) req.session.device = sealed;
}

/**
 * 로그인한 요청마다: 기록이 없으면(이 기능 전의 세션) 지금 것으로 만들고(로그인 시각은 세션의 loginAt),
 * 마지막 활동이 SEEN_EVERY_MS 를 넘었거나 IP · 브라우저가 바뀌었으면 다시 적는다. 그 밖은 세션을 건드리지 않는다
 */
function noteDevice(req: Request, _res: Response, next: NextFunction) {
  if (req.session?.user) {
    const now = Date.now();
    const ua = userAgentOf(req);
    const ip = req.ip ?? "";
    const was = openRecord(req.sessionID, req.session.device);
    if (!was || now - was.seenAt >= SEEN_EVERY_MS || was.ip !== ip || was.ua !== ua) {
      const sealed = seal(req.sessionID, { ua, ip, signedInAt: was?.signedInAt ?? req.session.loginAt ?? now, seenAt: now });
      if (sealed) req.session.device = sealed;
    }
  }
  next();
}

/** 세션을 가리키는 손잡이. 쿠키 값이 곧 세션 id 라 그대로 내보내지 않는다. 찾을 때는 그 사용자의 세션 안에서만 견준다 */
const handleOf = (sid: string) => crypto.createHash("sha256").update(sid).digest("base64url").slice(0, 22);

/** IP 위치를 찾는 쪽(dashboard 의 IP 위치 DB). 찾지 못하면 null */
type Locate = (ip: string) => DevicePlace;

/** 사설 주소면 내부망, 아니면 위치 DB 에 묻는다 */
function placeOf(ip: string, locate: Locate): DevicePlace {
  if (!ip) return null;
  return isPublicIp(ip) ? locate(ip) : { kind: "private" };
}

const KINDS = new Set(["mobile", "tablet"]);

/** 화면에 보일 기기 하나 */
function describe(sid: string, session: Partial<SessionData>, currentSid: string, locate: Locate): LoginDevice {
  const record = openRecord(sid, session.device);
  const base = { id: handleOf(sid), current: sid === currentSid };
  if (!record) return { ...base, known: false, browser: null, os: null, kind: null, signedInAt: session.loginAt ?? null, seenAt: null, place: null };
  const { browser, os, device } = new UAParser(record.ua).getResult();
  const kind = device.type && KINDS.has(device.type) ? (device.type as "mobile" | "tablet") : browser.name ? "desktop" : null;
  return { ...base, known: true, browser: browser.name ?? null, os: os.name ?? null, kind, signedInAt: record.signedInAt, seenAt: record.seenAt, place: placeOf(record.ip, locate) };
}

export { recordLogin, noteDevice, describe, handleOf, placeOf, openRecord, SEEN_EVERY_MS };
export type { DeviceRecord, Locate };
