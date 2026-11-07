// IP 위치 DB(DB-IP City Lite, MMDB, CC BY 4.0, 위치를 보이는 화면에 출처 링크를 단다). 로그인한 기기 목록이 공인 주소의 도시, 지역, 나라를 조회한다(login-devices).
// 실행 파일이 아니라 숫자 표라 버전을 고정하지 않고 봇이 다운로드한다: database/geoip/dbip-city-lite-YYYY-MM.mmdb(버전은 파일 이름).
//   자동(GEOIP_AUTO_UPDATE): 가진 버전이 이번 달이 아니면 하루에 한 번 이번 달 버전에 HEAD 요청만 보내고, 있으면 다운로드한다.
//   수동: 운영자 패널의 확인(이번 달, 지난달 중 가장 새 버전), 업데이트.
// 다운로드: 임시 파일에 압축을 풀며 받고 → 열어서 읽히는지 확인 → 옛 버전을 삭제하고 이름을 바꾼다. 실패하면 쓰던 파일을 그대로 쓴다.
// 읽기: 파일 전체를 메모리에 올린다(약 130MB). 목록을 볼 때만 올리고 한동안 쓰지 않으면 내린다.
// 끄면(GEOIP_ENABLED) 받지도 읽지도 않는다. 받은 파일은 삭제하지 않는다

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import maxmind, { type CityResponse, type Reader } from "maxmind";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { httpFor } from "../infra/http.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { DevicePlace } from "./contract/identity.ts";
import type { GeoipCheck, GeoipStatus } from "./contract/admin.ts";
const log = logger.child({ category: "dashboard", sub: "geoip" });

const http = httpFor("dbip");
let DIR = path.join(PROJECT.database, "geoip");
const FILE = /^dbip-city-lite-(\d{4}-\d{2})\.mmdb$/;
const urlOf = (version: string) => `https://download.db-ip.com/free/dbip-city-lite-${version}.mmdb.gz`;
/** 자동 확인 간격 */
const CHECK_EVERY_MS = 24 * 60 * 60_000;
/** 기동 뒤 첫 자동 확인(기동을 늦추지 않게) */
const FIRST_CHECK_MS = 60_000;
/** 쓰지 않으면 내리는 시간 */
const IDLE_MS = 10 * 60_000;

/** 파일을 여는 것(테스트는 가짜를 넘긴다: 작은 MMDB 를 만들 도구가 없다) */
type Open = (file: string) => Promise<Pick<Reader<CityResponse>, "get" | "metadata">>;
let open: Open = (file) => maxmind.open<CityResponse>(file);

let reader: Pick<Reader<CityResponse>, "get" | "metadata"> | null = null;
let readerVersion: string | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let job: GeoipStatus["job"] = "idle";
let progress: { received: number; total: number | null } | null = null;
let lastError: string | null = null;
let busy: Promise<unknown> | null = null;

/** 이번 달, 지난달(YYYY-MM, UTC) */
function monthsNow(now = new Date()) {
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return [ym(now), ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];
}

/** 가진 버전들(새 것부터) */
function versionsOnDisk(): string[] {
  try {
    return fs
      .readdirSync(DIR)
      .flatMap((name) => FILE.exec(name)?.[1] ?? [])
      .sort()
      .reverse();
  } catch (error) {
    // 폴더가 아직 없다(다운로드한 적이 없다)
    if (codeOf(error) !== "ENOENT") log.debug(`IP 위치 DB 경로 읽기 실패: ${messageOf(error)}`);
    return [];
  }
}

const fileOf = (version: string) => path.join(DIR, `dbip-city-lite-${version}.mmdb`);
const current = () => versionsOnDisk()[0] ?? null;

function status(): GeoipStatus {
  const version = current();
  let bytes: number | null = null;
  if (version) {
    try {
      bytes = fs.statSync(fileOf(version)).size;
    } catch (error) {
      // 그새 새 버전으로 바뀌었다
      if (codeOf(error) !== "ENOENT") log.debug(`IP 위치 DB 파일 크기 읽기 실패: ${messageOf(error)}`);
      bytes = null;
    }
  }
  return { enabled: config.geoip.enabled, autoUpdate: config.geoip.autoUpdate, version, bytes, job, received: progress?.received ?? null, total: progress?.total ?? null, error: lastError };
}

function unload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  reader = null;
  readerVersion = null;
}

/** 목록을 그리기 전에 부른다. 켜져 있고 파일이 있으면 올린다(이미 올렸으면 내릴 때를 미룬다). 쓸 수 있으면 true */
async function load(): Promise<boolean> {
  const version = current();
  if (!config.geoip.enabled || !version) {
    unload();
    return false;
  }
  if (!reader || readerVersion !== version) {
    try {
      reader = await open(fileOf(version));
      readerVersion = version;
    } catch (error) {
      log.warn(`IP 위치 DB 열기 실패(위치 필드를 비움): ${messageOf(error)}`);
      unload();
      return false;
    }
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(unload, IDLE_MS);
  idleTimer.unref();
  return true;
}

/** 공인 주소의 위치. 올리지 않았거나 모르면 null. 이름은 한국어가 있으면 한국어 */
function locate(ip: string): DevicePlace {
  const hit = reader?.get(ip);
  if (!hit) return null;
  const name = (names: { en?: string; ko?: string } | undefined) => names?.ko ?? names?.en ?? null;
  return { kind: "geo", city: name(hit.city?.names), region: name(hit.subdivisions?.[0]?.names), country: name(hit.country?.names) };
}

/** 그 버전이 올라와 있으면 받는 크기, 없으면 null(HEAD 요청만 보낸다) */
async function sizeOf(version: string): Promise<number | null> {
  const res = await http.fetch(urlOf(version), { method: "HEAD", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    // 없는 버전이면 404. 다른 거절도 없는 버전으로 보되 까닭을 남긴다
    if (res.status !== 404) log.debug(`IP 위치 DB ${version} 버전 확인: HTTP ${res.status}`);
    return null;
  }
  return Number(res.headers.get("content-length")) || 0;
}

/** 받을 수 있는 가장 새 버전(이번 달, 지난달) */
async function check(): Promise<GeoipCheck> {
  // 받는 중이면 그 표시를 덮지 않는다
  const mine = job === "idle";
  if (mine) job = "checking";
  try {
    for (const version of monthsNow()) {
      const size = await sizeOf(version);
      if (size !== null) return { current: current(), latest: version, size };
    }
    return { current: current(), latest: null, size: null };
  } finally {
    if (mine) job = "idle";
  }
}

/** 그 버전을 받아 교체한다. 실패하면 던지고 쓰던 파일은 그대로 */
async function download(version: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = path.join(DIR, `.download-${process.pid}.mmdb`);
  job = "downloading";
  progress = { received: 0, total: null };
  try {
    const res = await http.fetch(urlOf(version), { signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    progress.total = Number(res.headers.get("content-length")) || null;
    const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      if (progress) progress.received += chunk.length;
    });
    await pipeline(body, createGunzip(), fs.createWriteStream(temp));
    // 읽히는지 본다(도시 DB 인지까지)
    const probe = await open(temp);
    if (!/City/i.test(probe.metadata.databaseType)) throw new Error(`도시 DB 가 아님(${probe.metadata.databaseType})`);
    unload();
    for (const old of versionsOnDisk()) fs.rmSync(fileOf(old), { force: true });
    fs.renameSync(temp, fileOf(version));
    lastError = null;
    log.info(`IP 위치 DB 다운로드 완료: ${version} (${Math.round(fs.statSync(fileOf(version)).size / 1e6)}MB)`);
  } catch (error) {
    lastError = messageOf(error);
    log.warn(`IP 위치 DB 다운로드 실패(기존 버전 유지): ${lastError}`);
    throw error;
  } finally {
    fs.rmSync(temp, { force: true });
    job = "idle";
    progress = null;
  }
}

/** 하나씩만. 하는 중이면 그것을 기다린다 */
function once<T>(work: () => Promise<T>): Promise<T> {
  if (busy) return busy as Promise<T>;
  const run = work().finally(() => (busy = null));
  busy = run;
  return run;
}

/** 운영자의 업데이트: 가장 새 버전을 받는다. 이미 그 버전이면 받지 않는다. 받은 버전(없으면 null) */
const update = () =>
  once(async () => {
    // 받기 실패는 download 가 남긴다
    const { latest } = await check().catch((error: unknown) => {
      log.warn(`IP 위치 DB 버전 확인 실패: ${messageOf(error)}`);
      throw error;
    });
    if (latest && latest !== current()) await download(latest);
    return current();
  });

/** 자동: 켜져 있고 자동 업데이트이고 가진 버전이 이번 달이 아니면, 이번 달 버전이 올라왔을 때 받는다(파일이 아예 없으면 지난달 버전이라도) */
async function autoCheck() {
  if (!config.geoip.enabled || !config.geoip.autoUpdate || busy) return;
  const [thisMonth, lastMonth] = monthsNow();
  const have = current();
  if (have === thisMonth) return;
  const probe = (version: string) =>
    sizeOf(version).catch((error: unknown) => {
      log.debug(`IP 위치 DB ${version} 버전 확인 실패: ${messageOf(error)}`);
      throw error;
    });
  try {
    await once(async () => {
      if ((await probe(thisMonth)) !== null) return download(thisMonth);
      if (!have && (await probe(lastMonth)) !== null) return download(lastMonth);
      log.debug(`IP 위치 DB ${thisMonth} 버전이 아직 없음(내일 다시 확인)`);
    });
  } catch {
    // 내일 다시 본다(까닭은 probe, download 가 남겼다)
  }
}

/** 기동 시 한 번. 받다 꺼진 임시 파일을 치우고 자동 확인을 건다(봇이 꺼지는 것을 막지 않는다). 위치 DB 설정을 바꾸면: 끄면 올린 것을 내리고, 켜면 바로 한 번 본다 */
function start() {
  try {
    for (const name of fs.readdirSync(DIR)) if (name.startsWith(".download-")) fs.rmSync(path.join(DIR, name), { force: true });
  } catch (error) {
    // 폴더가 아직 없다
    if (codeOf(error) !== "ENOENT") log.debug(`IP 위치 DB 임시 파일 삭제 실패: ${messageOf(error)}`);
  }
  setTimeout(() => void autoCheck(), FIRST_CHECK_MS).unref();
  setInterval(() => void autoCheck(), CHECK_EVERY_MS).unref();
  let before = `${config.geoip.enabled}|${config.geoip.autoUpdate}`;
  onTunablesChanged(() => {
    const now = `${config.geoip.enabled}|${config.geoip.autoUpdate}`;
    if (now === before) return; // 다른 조절값을 저장했다
    before = now;
    if (!config.geoip.enabled) unload();
    else void autoCheck();
  });
}

// 테스트용: 폴더, 여는 함수를 바꾼다. 인자 없이 부르면 실제 구현으로
function _use({ dir = path.join(PROJECT.database, "geoip"), opener = (file: string) => maxmind.open<CityResponse>(file) }: { dir?: string; opener?: Open } = {}) {
  DIR = dir;
  open = opener;
  unload();
  lastError = null;
}

export { status, load, locate, check, update, autoCheck, start, monthsNow, http as _http, _use };
