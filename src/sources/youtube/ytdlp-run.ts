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
import { NEEDS_POT, playerClients } from "./clients.ts";
import * as auth from "./auth.ts";
import * as errors from "./errors.ts";
// 어긋난 미디어 주소를 다시 받기 전에 잠깐 쉰다. 곧바로 다시 물으면 같은 것을 받기 쉽다.
const STALE_RETRY_MS = 700;

/**
 * yt-dlp 호출을 연령 제한 폴백과 함께 실행.
 *  - 해당 videoId가 이미 연령 제한으로 알려져 있으면 처음부터 쿠키 사용(실패 시도 생략 → 영상당 실패 1회 보장).
 *  - 평상시(bgutil) 시도가 연령 제한으로 실패하면 videoId를 기록하고 쿠키로 1회 재시도.
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

  try {
    return await _runWithClients(url, buildOptions, known, exec);
  } catch (error) {
    if (!known && videoId && errors.isAgeRestrictedError(error) && auth.cookiesConfigured()) {
      try {
        externalCaches.markAgeRestricted(videoId);
      } catch {
        /* 기록 실패는 무시 */
      }
      log.warn({ tags: ["retry", "fallback"] }, `연령 제한 감지 (${videoId}). 쿠키로 재시도합니다`);
      return await _runWithClients(url, buildOptions, true, exec, true);
    }

    // 서명된 미디어 주소가 어긋난 경우. 한 번 더 받아 새 주소를 얻는다.
    // 클라이언트 목록을 안 쓰는 설치에서는 이 재시도가 유일한 회복 수단이다.
    if (errors.isStaleMediaError(error)) {
      log.warn({ tags: ["retry"] }, `미디어 주소가 어긋났습니다 (${videoId || url}). 다시 받습니다`);
      await new Promise((done) => setTimeout(done, STALE_RETRY_MS));
      return await _runWithClients(url, buildOptions, known, exec, true);
    }

    throw error;
  }
}

/**
 * player_client를 순서대로 시도한다. 지정이 없으면 호출 한 번으로 끝. 기존과 동일하다.
 *
 * 클라이언트 탓으로 보이는 실패에서만 다음으로 넘어가고 빈도를 기록한다. 영상이 없어졌거나
 * 연령 제한이거나 네트워크가 끊긴 것은 클라이언트 잘못이 아니므로 그대로 위로 던진다.
 * 그걸 섞어 세면 멀쩡한 클라이언트가 제외된다.
 * retry: 다시 묻는 것이다. 첫 시도 뒤의 시도도 다시 묻기라 yt-dlp 줄의 맨 앞에 선다(곡 찾기 하나가 줄 끝을 여러 번 기다리지 않게)
 */
async function _runWithClients(url: string, buildOptions: BuildOptions, forceCookies: boolean, exec: RunYtDlp, retry = false): Promise<unknown> {
  const table = playerClients();
  const clients = table.idle ? [] : table.list();

  if (clients.length === 0) {
    if (!table.idle) table.noteExhausted(); // 지정은 했는데 전부 제외됨
    return _runOnce(url, buildOptions(forceCookies), null, exec, retry);
  }

  let lastError: unknown = null;
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    try {
      const result = await _runOnce(url, buildOptions(forceCookies), client, exec, retry || i > 0);
      table.record(client, true);
      return result;
    } catch (error) {
      if (!errors.isClientFault(error)) throw error; // 영상·네트워크 문제. 클라이언트 바꿔봐야 소용없다
      lastError = error;
      table.record(client, false);
      const next = clients[i + 1];
      log.warn({ tags: ["fallback"] }, `${client} 실패 (${errors._faultReason(error)})${next ? `. ${next} 로 전환합니다` : ""}`);
    }
  }

  // 지정한 것이 다 안 됐다. yt-dlp 기본값에 한 번 맡겨 본다. 유지보수되는 쪽이 더 나을 수 있다.
  log.warn({ tags: ["fallback"] }, `지정한 클라이언트를 모두 시도했습니다. yt-dlp 기본값으로 마지막 시도를 합니다`);
  try {
    return await _runOnce(url, buildOptions(forceCookies), null, exec, true);
  } catch {
    throw lastError; // 원인 파악에는 클라이언트별 실패가 더 유용하다
  }
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

export { runYtDlp, _runWithClients, _runOnce, _inspectWarnings };
export type { BuildOptions };
