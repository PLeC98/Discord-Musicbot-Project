// yt-dlp 실행. 플레이어 클라이언트를 바꿔 가며 다시 묻고, 쿠키로 한 번 더 묻는다.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });
import * as links from "../../rules/links.ts";
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlp-spawn.ts";

import type { YtDlpFlags as Flags, RunYtDlp } from "../ytdlp-spawn.ts";

/** forceCookies 를 받아 yt-dlp 옵션을 만든다(연령 제한이면 쿠키를 붙여 다시 만든다) */
type BuildOptions = (forceCookies: boolean) => Flags;
import * as externalCaches from "../../store/external-caches.ts";
import * as cookieJar from "../../store/cookie-jar.ts";
import { assertAgeAllowed } from "../age-gate.ts";
import { NEEDS_POT, playerClients } from "./clients.ts";
import * as auth from "./auth.ts";
import * as errors from "./errors.ts";
import * as recentInfo from "./recent-info.ts";
import fs from "node:fs";
import path from "node:path";
import { clearOutput, familyOf } from "../ytdlp-spawn.ts";
// 어긋난 미디어 주소를 다시 받기 전에 잠깐 쉰다. 곧바로 다시 물으면 같은 것을 받기 쉽다.
const STALE_RETRY_MS = 700;

/** 음원 포맷 고르기. 오디오 전용이 없으면 영상이 섞인 것도 받는다. 시도마다 좁히고 넓히는 것은 formatFor 가 한다 */
const AUDIO_FORMAT = "bestaudio/best";
// 영상이 섞인 것을 받을 때는 작은 것부터(360p 통합이 1080p HLS 보다 다섯 배쯤 작고 소리는 같은 AAC 다)
const SMALL_VIDEO = ["res:360"] as unknown as Flags["formatSort"];

/**
 * yt-dlp 호출을 연령 제한 폴백과 함께 실행.
 *  - 해당 videoId가 이미 연령 제한으로 알려져 있으면 처음부터 쿠키 사용(실패 시도 생략 → 영상당 실패 1회 보장).
 *  - 평상시(bgutil) 시도가 연령 제한으로 실패하면 videoId를 기록하고 쿠키로 1회 재시도.
 *  - 운영자가 연령 제한 콘텐츠를 꺼 두었으면 둘 다 하지 않고 age-content-off 로 거절한다(sources/age-gate).
 * @param {string} url
 * @param {(forceCookies:boolean)=>object} buildOptions  forceCookies를 받아 yt-dlp 옵션을 만드는 함수
 */
// exec: yt-dlp 를 실행하는 함수. 생략하면 진짜(ytdlpSpawn)
async function runYtDlp(url: string, buildOptions: BuildOptions, exec: RunYtDlp = youtubedl): Promise<unknown> {
  const videoId = links.extractVideoId(url);
  let known = false;
  try {
    known = videoId ? externalCaches.isAgeRestricted(videoId) : false;
  } catch {
    /* 캐시 미초기화 등. 기본값 false */
  }
  if (known && videoId) assertAgeAllowed(videoId);

  try {
    return await _runWithClients(url, buildOptions, known, exec);
  } catch (error) {
    if (!known && videoId && errors.isAgeRestrictedError(error)) return await _retryWithCookies(url, videoId, buildOptions, exec, error);

    // 서명된 미디어 주소가 어긋난 경우. 한 번 더 받아 새 주소를 얻는다.
    // 클라이언트 목록을 안 쓰는 설치에서는 이 재시도가 유일한 회복 수단이다.
    if (errors.isStaleMediaError(error)) {
      log.warn({ tags: ["retry"] }, `미디어 주소가 어긋났습니다 (${videoId || url}). 다시 받습니다`);
      await new Promise((done) => setTimeout(done, STALE_RETRY_MS));
      // 다운로드면 받다 만 파일을 지운다(다시 받을 때 포맷이 다르면 이어 붙인 파일이 깨진다)
      const output = buildOptions(known).output;
      if (output) clearOutput(output);
      return await _runWithClients(url, buildOptions, known, exec, true);
    }

    throw error;
  }
}

/** 처음 알게 된 연령 제한. 연령 제한 콘텐츠를 껐으면 거절하고, 쿠키가 있으면 적어 두고 쿠키로 한 번 더, 없으면 그 실패 그대로 */
async function _retryWithCookies(url: string, videoId: string, buildOptions: BuildOptions, exec: RunYtDlp, error: unknown): Promise<unknown> {
  assertAgeAllowed(videoId, error);
  if (!auth.cookiesConfigured()) throw error;
  try {
    externalCaches.markAgeRestricted(videoId);
  } catch {
    /* 기록 실패는 무시 */
  }
  log.warn({ tags: ["retry", "fallback"] }, `연령 제한 감지 (${videoId}). 쿠키로 재시도합니다`);
  return await _runWithClients(url, buildOptions, true, exec, true);
}

/**
 * player_client를 순서대로 시도한다. 지정이 없으면 호출 한 번으로 끝.
 *
 * 클라이언트 탓으로 보이는 실패에서만 다음으로 넘어가고 빈도를 기록한다. 영상이 없어졌거나
 * 연령 제한이거나 네트워크가 끊긴 것은 클라이언트 잘못이 아니므로 그대로 위로 던진다.
 * 그걸 섞어 세면 멀쩡한 클라이언트가 제외된다. 쿠키를 못 받아 건너뛴 클라이언트는 세지 않고 다음으로 간다.
 * 쿠키 없는 클라이언트 시도는 오디오 전용만 받는다(SABR 이 걸리면 영상이 섞인 포맷만 남는 클라이언트가 있다). 마지막 시도 · 쿠키 시도는 무엇이든 받는다.
 * retry: 다시 묻는 것이다. 첫 시도 뒤의 시도도 다시 묻기라 yt-dlp 줄의 맨 앞에 선다(곡 찾기 하나가 줄 끝을 여러 번 기다리지 않게)
 */
async function _runWithClients(url: string, buildOptions: BuildOptions, forceCookies: boolean, exec: RunYtDlp, retry = false): Promise<unknown> {
  const table = playerClients();
  const clients = table.idle ? [] : table.list();

  if (clients.length === 0) {
    if (!table.idle) table.noteExhausted(); // 지정은 했는데 전부 제외됨
    return _runOnce(url, formatFor(buildOptions(forceCookies), false), null, exec, retry);
  }

  let lastError: unknown = null;
  // 다운로드를 다른 클라이언트로 다시 받기 전에 받다 만 파일을 지운다(클라이언트마다 고르는 포맷이 달라 이어 붙인 파일이 깨진다)
  const output = buildOptions(forceCookies).output;
  const fresh = () => {
    if (output) clearOutput(output);
  };
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    if (i > 0) fresh();
    const options = formatFor(buildOptions(forceCookies), !forceCookies);
    try {
      const result = await _runOnce(url, options, client, exec, retry || i > 0);
      if (!forceCookies) requireAudioOnly(result, options);
      table.record(client, true);
      return result;
    } catch (error) {
      const next = clients[i + 1];
      if (errors.isSkippedClientError(error)) {
        lastError = error;
        log.debug(`${client} 는 쿠키를 받지 않아 yt-dlp 가 건너뛰었습니다${next ? `. ${next} 로 전환합니다` : ""}`);
        continue;
      }
      if (!errors.isClientFault(error)) throw error; // 영상·네트워크 문제. 클라이언트 바꿔봐야 소용없다
      lastError = error;
      table.record(client, false);
      log.warn({ tags: ["fallback"] }, `${client} 실패 (${errors._faultReason(error)})${next ? `. ${next} 로 전환합니다` : ""}`);
    }
  }

  // 지정한 것이 다 안 됐다. yt-dlp 기본값에 한 번 맡겨 본다. 유지보수되는 쪽이 더 나을 수 있다.
  log.warn({ tags: ["fallback"] }, `지정한 클라이언트를 모두 시도했습니다. yt-dlp 기본값으로 마지막 시도를 합니다`);
  fresh();
  try {
    return await _runOnce(url, formatFor(buildOptions(forceCookies), false), null, exec, true);
  } catch {
    throw lastError; // 원인 파악에는 클라이언트별 실패가 더 유용하다
  }
}

/**
 * 시도에 맞춘 포맷 고르기. AUDIO_FORMAT 을 쓰는 실행만 바꾼다.
 * audioOnly: 오디오 전용만 받는다. 다운로드는 고르기를 좁히고(라이브는 받지 않는다), 정보 추출은 고른 것을 requireAudioOnly 가 본다(라이브는 오디오 전용이 없다).
 * 아니면 영상이 섞인 것도 받되 작은 것부터
 */
function formatFor(options: Flags, audioOnly: boolean): Flags {
  if (options.format !== AUDIO_FORMAT) return options;
  if (!audioOnly) return { ...options, formatSort: SMALL_VIDEO };
  return options.dumpSingleJson ? options : { ...options, format: "bestaudio" };
}

/** 정보 추출이 영상이 섞인 포맷을 골랐으면(라이브가 아닌데) 그 클라이언트의 실패로 친다 */
function requireAudioOnly(result: unknown, options: Flags) {
  if (options.format !== AUDIO_FORMAT || !options.dumpSingleJson) return;
  const info = result as { vcodec?: string | null; format_id?: string; is_live?: boolean; live_status?: string } | null;
  if (!info?.vcodec || info.vcodec === "none") return;
  if (info.is_live || info.live_status === "is_live" || info.live_status === "is_upcoming") return;
  throw Object.assign(new Error(`오디오 전용 포맷이 없습니다(고른 것 ${info.format_id ?? "모름"})`), { code: errors.NO_AUDIO_ONLY });
}

/**
 * 한 번 호출 + 경고 훑기.
 * 호출부가 extractorArgs를 직접 넘겼으면 그쪽이 이긴다. 명시적 지정을 폴백이 덮지 않는다.
 * 클라이언트를 하나씩만 넘기는 이유는 _runWithClients 의 주석 참조.
 */
async function _runOnce(url: string, options: Flags, client: string | null, exec: RunYtDlp = youtubedl, retry = false): Promise<unknown> {
  const opts = client && !options.extractorArgs ? { ...options, extractorArgs: `youtube:player_client=${client}` } : options;
  // 대시보드에 입력한 쿠키는 이 실행만의 파일로 풀어 넘기고, 끝나면 고친 쿠키를 되담고 삭제한다(store/cookie-jar)
  const held = opts.cookies === cookieJar.JAR ? cookieJar.checkout() : null;
  const sent = opts.cookies === cookieJar.JAR ? { ...opts, cookies: held?.file } : opts;
  if (sent.cookies === undefined) delete sent.cookies;
  try {
    const result = await exec(url, sent, retry ? { retry } : undefined);
    _inspectWarnings((result as { _stderr?: string } | null)?._stderr, client);
    return result;
  } finally {
    if (held) cookieJar.release(held);
  }
}

/**
 * 성공했어도 경고는 볼 값어치가 있다. 특히 "POToken이 필요하다"는, 안 쓰던 클라이언트가
 * 쓰기 시작했다는 신호다. 유튜브가 조이는 것을 우리가 제일 먼저 아는 지점이다.
 */
function _inspectWarnings(stderr: unknown, client: string | null) {
  if (!stderr) return;
  for (const line of String(stderr).split("\n")) {
    if (!/^WARNING/i.test(line)) continue;
    // yt-dlp가 모르는 이름은 실패가 아니라 기본 클라이언트로 조용히 떨어져 성공한다.
    // 그러면 우리 폴백 루프가 첫 항목에서 끝나 뒤 목록이 통째로 사문화된다. 이건 알려야 한다.
    const skipped = line.match(/Skipping unsupported client "?([\w-]+)"?/i);
    if (skipped) {
      log.warn(`${skipped[1]} 은(는) 이 yt-dlp가 모르는 클라이언트입니다. 건너뛰고 yt-dlp 기본값으로 재생했습니다. 유튜브 탭의 "유튜브 클라이언트 순서"에서 고쳐 주세요`);
      continue;
    }
    if (/require[sd]? a .*PO Token|PO Token which was not provided/i.test(line)) {
      // 요구한 클라이언트 이름은 경고 본문에 적혀 온다("web_creator client https formats require...").
      // 우리가 지정한 값을 쓰면 안 된다. 연령 제한 영상에서는 우리가 선택하지 않은 web_creator 가
      // yt-dlp 판단으로 끼어들기 때문에, 지정값으로 찍으면 엉뚱한 이름이 남는다.
      const named = line.match(/\b([a-z][\w-]*) client\b/i);
      const asked = named ? named[1] : client;
      const who = asked || "기본 클라이언트";
      if (asked && NEEDS_POT.includes(asked)) log.debug(`${who}: POToken을 요구했습니다 (알려진 특성)`);
      else log.warn({ tags: ["youtube-change"] }, `${who}가 POToken을 요구했습니다. 유튜브 정책이 바뀐 것으로 보입니다`);
      continue;
    }
    log.debug(`yt-dlp 경고${client ? ` (${client})` : ""}: ${line.replace(/^WARNING:\s*/i, "").trim()}`);
  }
}

// 받아 둔 정보로 받다 실패했을 때 추출부터 다시 받을 까닭: 받기 자체가 실패했다(낡은 주소 · 요청 제한 · 연결 · 멎음). 변환 실패 · 끄는 중은 다시 받아도 같다
const FETCH_FAILED = new Set(["stale-media", "rate-limited", "network-error"]);

/**
 * 유튜브 음원 다운로드(buildOptions 의 output 으로). 받아 둔 영상 정보(recent-info)가 있으면 다시 추출하지 않고 그것으로 한 번 받는다
 * (--load-info-json. 불러온 정보에는 클라이언트 바꾸기 · 낡은 주소 다시 받기 · 쿠키가 소용없어 그 길을 타지 않는다).
 * 받기가 실패하면 받다 만 파일을 지우고 추출부터 받는다. 끝나면(성공 · 실패) 받아 둔 정보를 지운다(다음부터는 캐시 파일로 튼다)
 */
async function downloadAudio(url: string, buildOptions: BuildOptions, exec: RunYtDlp = youtubedl): Promise<unknown> {
  const id = links.extractVideoId(url);
  try {
    const known = id ? recentInfo.recall(id) : null;
    const output = buildOptions(false).output;
    if (known && output) {
      const done = await fromInfo(known, buildOptions(false), output, exec);
      if (done) return done.result;
    }
    return await runYtDlp(url, buildOptions, exec);
  } finally {
    if (id) recentInfo.forget(id);
  }
}

// 받아 둔 정보로 한 번. 받기가 실패했으면 묶음을 지우고 null(추출부터 받게), 그 밖의 실패는 던진다
async function fromInfo(info: unknown, options: Flags, output: string, exec: RunYtDlp): Promise<{ result: unknown } | null> {
  const { dir, stem } = familyOf(output);
  // 출력 묶음 안(임시 파일 정리 · 멎은 다운로드 감시가 그대로 덮는다)
  const file = path.join(dir, `${stem}.load.json`);
  // 불러온 정보에서 다시 고른다. 추출이 고른 것과 같게, 오디오 전용이 없으면 작은 영상부터
  const { cookies: _cookies, cookiesFromBrowser: _browser, ...flags } = formatFor(options, false);
  try {
    fs.writeFileSync(file, JSON.stringify(info));
    return { result: await exec("", { ...flags, loadInfoJson: file }) };
  } catch (error) {
    if (!FETCH_FAILED.has(String((error as { code?: unknown } | null)?.code))) throw error;
    log.debug(`받아 둔 영상 정보로 받지 못해 추출부터 다시 받습니다: ${errors.briefError(error, 1)}`);
    clearOutput(output);
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export { AUDIO_FORMAT, runYtDlp, downloadAudio, _runWithClients, _runOnce, _inspectWarnings };
export type { BuildOptions };
