// 봇 운영자와 초대 권한의 근거인 앱 정보(rules/app-owners)를 보관한다. 기동이 앱 설정을 읽은 결과로 처음 넣고(app/main),
// 그 뒤 10분마다, 대시보드 로그인 때 다시 받는다. 받는 함수는 기동이 넘긴다(이 층은 디스코드 REST 를 직접 부르지 않는다).
// 덮어쓰기(OWNER_ID)는 여기에 굳히지 않고 판정할 때마다 설정 객체에서 읽는다

import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { L } from "../infra/log/text.ts";
import { messageOf } from "../rules/error-kind.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { nameOf, operatorsOf, overrideIds, readAppOwners, type AppOwners, type OperatorScope } from "../rules/app-owners.ts";
import type { LogText } from "../infra/log/log-text.ts";

const log = logger.child({ category: "core" });

/** 다시 받는 간격(ms) */
const REFRESH_MS = 10 * 60_000;
/** 받기에 실패하면 이만큼 기다렸다 다시 받는다(ms). 이어 실패하면 다음 값으로, 끝 값에서 머문다 */
const RETRY_MS = [60_000, 120_000, 240_000, 480_000, REFRESH_MS];
/** 마지막 성공에서 이만큼 지나면 넓힌 범위를 되돌리고 소유자만 남긴다(ms). 그동안 팀에서 빠진 사람이 운영자로 남는 시간의 상한 */
const STALE_MS = 60 * 60_000;
/** 대시보드 로그인 때 다시 받기: 직전 성공이 이만큼 이내면 건너뛴다(ms) */
const LOGIN_FRESH_MS = 60_000;

type Read = () => Promise<unknown>;

let held: { app: AppOwners; at: number } | null = null;
let read: Read | null = null;
let inFlight: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let failures = 0;
let retryAt = 0;
let staleTold = false;
// 다시 받기 순번. 더 늦게 시작한 받기의 결과가 이미 들어갔으면 먼저 시작한 받기의 결과는 버린다
let started = 0;
let applied = 0;
let lastOperators: string[] = [];
const listeners = new Set<() => void>();

/** 넓히는 범위(운영 설정값). 마지막 성공이 오래됐으면 소유자만 */
function scopeAt(now: number): OperatorScope {
  if (isStale(now)) return "owner";
  return config.dashboard.operators.scope;
}

/** 앱 정보를 오랫동안 받지 못해 넓힌 범위를 되돌린 상태인가 */
const isStale = (now = Date.now()) => held !== null && now - held.at > STALE_MS;

/** 앱 정보로 정한 운영자(덮어쓰기는 보지 않는다). 앱 정보가 없으면 빈 목록 */
function appOperators(now = Date.now()): string[] {
  return held ? operatorsOf(held.app, scopeAt(now)) : [];
}

/** 지금 운영자. 덮어쓰기(OWNER_ID)가 있으면 적힌 그대로, 없으면 앱 정보로 정한 운영자 */
function operators(now = Date.now()): string[] {
  return overrideIds(config.dashboard.ownerId) ?? appOperators(now);
}

/** 지금 받아 둔 앱 정보(초대 권한, 화면). 없으면 null */
const appOwners = (): AppOwners | null => held?.app ?? null;

/** 운영자가 바뀌면 부를 함수(빠진 사람의 운영자 스트림 끊기). 해제 함수를 돌려준다 */
function onOperatorsChanged(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 앱 정보로 정한 운영자가 바뀌었으면 남기고 알린다. quiet: 기록만 한다(기동은 따로 한 줄을 남긴다)
function announce(now: number, quiet = false) {
  const next = appOperators(now);
  const added = next.filter((id) => !lastOperators.includes(id));
  const removed = lastOperators.filter((id) => !next.includes(id));
  lastOperators = next;
  if (quiet || (!added.length && !removed.length)) return;
  const named = (ids: string[]) => ids.map((id) => (held ? `${nameOf(held.app, id)}(${id})` : id)).join(", ");
  log.info(L.core.operatorsChanged({ added: named(added), removed: named(removed) }));
  for (const listener of listeners) listener();
}

/** 받은 응답을 넣는다. 형식이 틀리면 넣지 않고 false. seq: 다시 받기 순번, quiet: 바뀐 것을 남기지 않는다(기동) */
function put(raw: unknown, seq: number, now: number, quiet = false): boolean {
  const app = readAppOwners(raw);
  if (!app) {
    log.warn(L.core.appOwnersUnknown());
    return false;
  }
  if (seq < applied) return true;
  applied = seq;
  held = { app, at: now };
  failures = 0;
  retryAt = 0;
  staleTold = false;
  announce(now, quiet);
  return true;
}

/** 범위의 이름(로그) */
function scopeText(app: AppOwners, scope: OperatorScope): LogText {
  if (app.kind === "personal") return L.core.operatorsFromOwner();
  if (scope === "admin") return L.core.operatorsFromTeamAdmin();
  if (scope === "developer") return L.core.operatorsFromTeamDeveloper();
  return L.core.operatorsFromTeamOwner();
}

/** 기동: 앱 설정을 읽은 응답을 처음 넣고 운영자를 남긴다. 그 뒤 다시 받기를 시작한다(reader: 앱 설정을 다시 읽는 함수) */
function startAppOwners(raw: unknown, reader: Read) {
  read = reader;
  const now = Date.now();
  put(raw, ++started, now, true);
  const override = overrideIds(config.dashboard.ownerId);
  const auto = appOperators(now);
  if (override) {
    const same = held !== null && override.length === auto.length && override.every((id) => auto.includes(id));
    log.info(same ? L.core.operatorsOverrideSame({ count: override.length }) : L.core.operatorsOverrideDiffers({ count: override.length }));
  } else if (held && auto.length) {
    log.info(L.core.operatorsSet({ names: auto.map((id) => nameOf(held!.app, id)).join(", "), from: scopeText(held.app, scopeAt(now)) }));
  } else {
    log.warn(L.core.operatorsNone());
  }
  schedule(REFRESH_MS);
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refreshAppOwners(), ms);
  timer.unref();
}

/**
 * 앱 정보를 다시 받는다. 받는 중이면 진행 중인 받기를 기다린다. 실패하면 마지막 것을 쓰고 간격을 늘려 다시 받는다.
 * freshMs: 마지막 성공이 이만큼 이내면 받지 않는다(대시보드 로그인). 실패 뒤 다시 받을 때가 되지 않았어도 받지 않는다
 */
function refreshAppOwners({ freshMs = 0 }: { freshMs?: number } = {}): Promise<void> {
  if (!read) return Promise.resolve();
  if (inFlight) return inFlight;
  const now = Date.now();
  if (freshMs && held && now - held.at < freshMs) return Promise.resolve();
  if (freshMs && now < retryAt) return Promise.resolve();
  const seq = ++started;
  inFlight = read()
    .then((raw) => {
      if (!put(raw, seq, Date.now())) failed(L.core.appOwnersUnknownShort());
    })
    .catch((error: unknown) => failed(messageOf(error)))
    .finally(() => {
      inFlight = null;
      if (failures === 0) schedule(REFRESH_MS);
    });
  return inFlight;
}

// 받기에 실패했다: 마지막 것을 쓰고, 오래되면 넓힌 범위를 되돌리고 알린다
function failed(error: string | LogText) {
  const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
  if (failures === 0) log.warn(L.core.appOwnersRefreshFailed({ error, minutes: wait / 60_000 }));
  failures++;
  retryAt = Date.now() + wait;
  schedule(wait);
  const now = Date.now();
  if (!staleTold && held && now - held.at > STALE_MS) {
    staleTold = true;
    log.warn(L.core.appOwnersStale({ hours: STALE_MS / 3_600_000 }));
  }
  announce(now);
}

/** 대시보드 로그인 때: 마지막 성공이 1분 이내가 아니면 다시 받는다. 최대 waitMs 까지만 기다린다 */
function refreshOnLogin(waitMs = 2000): Promise<void> {
  const done = refreshAppOwners({ freshMs: LOGIN_FRESH_MS });
  return Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref())]);
}

// 넓히는 범위(운영 설정값)를 바꾸거나 불러오면 운영자를 다시 계산해 알린다
onTunablesChanged(() => announce(Date.now()));

/** 앱 소유자(개인 앱의 소유자, 팀 앱의 팀 소유자)인가. 넓히는 범위는 이 사람만 바꾼다(덮어쓰기로 운영자가 된 사람은 제외) */
const isAppOwner = (userId: string) => held !== null && held.app.ownerId === userId;

// 테스트용: 앱 정보를 넣고(null 이면 비움) 다시 받기를 멈춘다
function _setAppOwners(raw: unknown, { at = Date.now(), reader = null }: { at?: number; reader?: Read | null } = {}) {
  if (timer) clearTimeout(timer);
  timer = null;
  read = reader;
  inFlight = null;
  failures = 0;
  retryAt = 0;
  staleTold = false;
  held = null;
  lastOperators = [];
  if (raw !== null) put(raw, ++started, at, true);
  else applied = ++started;
}

export { startAppOwners, refreshAppOwners, refreshOnLogin, operators, appOperators, appOwners, isAppOwner, isStale, onOperatorsChanged, _setAppOwners, REFRESH_MS, STALE_MS };
