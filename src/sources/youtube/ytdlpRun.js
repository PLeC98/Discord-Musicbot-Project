"use strict";

// yt-dlp 실행. 플레이어 클라이언트를 바꿔 가며 다시 묻고, 쿠키로 한 번 더 묻는다.

const log = require("../../infra/log/logger").child({ category: "youtube" });
const links = require("../../rules/links");
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("../ytdlpSpawn");
const config = require("../../../config");
const externalCaches = require("../../store/externalCaches");
const { PlayerClients, NEEDS_POT } = require("./clients");

const playerClients = new PlayerClients(config.ytdlp.playerClients, { window: config.ytdlp.clientWindow, fails: config.ytdlp.clientFails });
// 어긋난 미디어 주소를 다시 받기 전에 잠깐 쉰다. 곧바로 다시 물으면 같은 것을 받기 쉽다.
const STALE_RETRY_MS = 700;
// 지금 쿠키 파일을 쥔 채 도는 yt-dlp 가 몇 개인가. 대시보드가 쿠키를 갈아 끼울 때 본다.
// yt-dlp 는 끝나면서 쿠키 항아리를 그 파일에 되쓰므로, 도는 중에 갈아 끼우면 옛것으로 되돌아간다.
let cookieRuns = 0;

class YouTubeRun {
  /** 쿠키 파일을 쥔 채 도는 yt-dlp 수. 0이 아니면 지금 갈아 끼운 것이 되돌아갈 수 있다 */
  static cookieRunsInFlight() {
    return cookieRuns;
  }

  /**
   * yt-dlp 호출을 연령 제한 폴백과 함께 실행.
   *  - 해당 videoId가 이미 연령 제한으로 알려져 있으면 처음부터 쿠키 사용(실패 시도 생략 → 영상당 실패 1회 보장).
   *  - 평상시(bgutil) 시도가 연령 제한으로 실패하면 videoId를 기록하고 쿠키로 1회 재시도.
   * @param {string} url
   * @param {(forceCookies:boolean)=>object} buildOptions  forceCookies를 받아 yt-dlp 옵션을 만드는 함수
   */
  // exec: yt-dlp 를 실행하는 함수. 생략하면 진짜(ytdlpSpawn)
  static async runYtDlp(url, buildOptions, exec = youtubedl) {
    const videoId = links.extractVideoId(url);
    let known = false;
    try {
      known = videoId ? externalCaches.isAgeRestricted(videoId) : false;
    } catch {
      /* 캐시 미초기화 등. 기본값 false */
    }

    try {
      return await this._runWithClients(url, buildOptions, known, exec);
    } catch (error) {
      if (!known && videoId && this.isAgeRestrictedError(error) && this.cookiesConfigured()) {
        try {
          externalCaches.markAgeRestricted(videoId);
        } catch {
          /* 기록 실패는 무시 */
        }
        log.warn({ tags: ["retry", "fallback"] }, `연령 제한 감지 (${videoId}). 쿠키로 재시도합니다`);
        return await this._runWithClients(url, buildOptions, true, exec);
      }

      // 서명된 미디어 주소가 어긋난 경우. 한 번 더 받아 새 주소를 얻는다.
      // 클라이언트 목록을 안 쓰는 설치에서는 이 재시도가 유일한 회복 수단이다.
      if (this.isStaleMediaError(error)) {
        log.warn({ tags: ["retry"] }, `미디어 주소가 어긋났습니다 (${videoId || url}). 다시 받습니다`);
        await new Promise((done) => setTimeout(done, STALE_RETRY_MS));
        return await this._runWithClients(url, buildOptions, known, exec);
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
   */
  static async _runWithClients(url, buildOptions, forceCookies, exec) {
    const clients = playerClients.idle ? [] : playerClients.list();

    if (clients.length === 0) {
      if (!playerClients.idle) playerClients.noteExhausted(); // 지정은 했는데 전부 제외됨
      return this._runOnce(url, buildOptions(forceCookies), null, exec);
    }

    let lastError = null;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      try {
        const result = await this._runOnce(url, buildOptions(forceCookies), client, exec);
        playerClients.record(client, true);
        return result;
      } catch (error) {
        if (!this.isClientFault(error)) throw error; // 영상·네트워크 문제. 클라이언트 바꿔봐야 소용없다
        lastError = error;
        playerClients.record(client, false);
        const next = clients[i + 1];
        log.warn({ tags: ["fallback"] }, `${client} 실패 (${this._faultReason(error)})${next ? `. ${next} 로 전환합니다` : ""}`);
      }
    }

    // 지정한 것이 다 안 됐다. yt-dlp 기본값에 한 번 맡겨 본다. 유지보수되는 쪽이 더 나을 수 있다.
    log.warn({ tags: ["fallback"] }, `지정한 클라이언트를 모두 시도했습니다. yt-dlp 기본값으로 마지막 시도를 합니다`);
    try {
      return await this._runOnce(url, buildOptions(forceCookies), null, exec);
    } catch {
      throw lastError; // 원인 파악에는 클라이언트별 실패가 더 유용하다
    }
  }

  /**
   * 한 번 호출 + 경고 훑기.
   * 호출부가 extractorArgs를 직접 넘겼으면 그쪽이 이긴다. 명시적 지정을 폴백이 덮지 않는다.
   * 클라이언트를 하나씩만 넘기는 이유는 _runWithClients 머리말 참조.
   */
  static async _runOnce(url, options, client, exec = youtubedl) {
    const opts = client && !options.extractorArgs ? { ...options, extractorArgs: `youtube:player_client=${client}` } : options;
    // 쿠키 파일이 실제로 넘어간 호출만 센다. 무쿠키 캐싱까지 세면 경고가 거짓이 된다
    const holdsCookieFile = !!opts.cookies;
    if (holdsCookieFile) cookieRuns++;
    try {
      const result = await exec(url, opts);
      this._inspectWarnings(result?._stderr, client);
      return result;
    } finally {
      if (holdsCookieFile) cookieRuns--;
    }
  }

  /**
   * 성공했어도 경고는 볼 값어치가 있다. 특히 "POToken이 필요하다"는, 안 쓰던 클라이언트가
   * 쓰기 시작했다는 신호다. 유튜브가 조이는 것을 우리가 제일 먼저 아는 지점이다.
   */
  static _inspectWarnings(stderr, client) {
    if (!stderr) return;
    for (const line of String(stderr).split("\n")) {
      if (!/^WARNING/i.test(line)) continue;
      // yt-dlp가 모르는 이름은 실패가 아니라 기본 클라이언트로 조용히 떨어져 성공한다.
      // 그러면 우리 폴백 루프가 첫 항목에서 끝나 뒤 목록이 통째로 사문화된다. 이건 알려야 한다.
      const skipped = line.match(/Skipping unsupported client "?([\w-]+)"?/i);
      if (skipped) {
        log.warn(`${skipped[1]} 은(는) 이 yt-dlp가 모르는 클라이언트입니다. 건너뛰고 yt-dlp 기본값으로 재생했습니다. .env에서 고쳐 주세요`);
        continue;
      }
      if (/require[sd]? a .*PO Token|PO Token which was not provided/i.test(line)) {
        // 요구한 클라이언트 이름은 경고 본문에 적혀 온다("web_creator client https formats require...").
        // 우리가 지정한 값을 쓰면 안 된다. 연령 제한 영상에서는 우리가 고르지 않은 web_creator 가
        // yt-dlp 판단으로 끼어들기 때문에, 지정값으로 찍으면 엉뚱한 이름이 남는다.
        const named = line.match(/\b([a-z][\w-]*) client\b/i);
        const asked = named ? named[1] : client;
        const who = asked || "기본 클라이언트";
        if (NEEDS_POT.includes(asked)) log.debug(`${who}: POToken을 요구했습니다 (알려진 특성)`);
        else log.warn({ tags: ["youtube-change"] }, `${who}가 POToken을 요구했습니다. 유튜브 정책이 바뀐 것으로 보입니다`);
        continue;
      }
      log.debug(`yt-dlp 경고${client ? ` (${client})` : ""}: ${line.replace(/^WARNING:\s*/i, "").trim()}`);
    }
  }
}

module.exports = { YouTubeRun, playerClients };
