// 유튜브 쿠키 파일(cookies.txt). 읽지 않고 자리만 맡는다.

import fs from "fs";
import path from "path";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import yamlStore from "./yamlStore.ts";
const { configDir } = yamlStore;

// ── cookies.txt ───────────────────────────────────────────────────────────
//
// 유튜브 쿠키. 다른 설정과 달리 우리가 읽지 않는다. 경로를 yt-dlp 에 넘기면 그쪽이 읽는다.
// 여기 두는 이유는 자리를 한 곳으로 모으기 위해서다(.env 에 경로를 적게 하면 대시보드가
// 어디를 고쳐야 하는지 물어야 한다).
//
// ⚠️ yt-dlp 는 `--cookies FILE` 을 읽기만 하지 않고 끝날 때 쿠키 항아리를 그 파일에 되쓴다.
//    그래서 mtime 은 "올린 시각"이 아니고, 쿠키를 쓰는 yt-dlp 가 도는 중에 덮어쓰면
//    그쪽이 끝나면서 옛 내용으로 되돌린다. 부르는 쪽이 그 상황을 알려 준다.

const COOKIES_FILE = "cookies.txt";

const cookiesPath = () => path.join(configDir(), COOKIES_FILE);

/**
 * 쓸 수 있는 쿠키 파일이 있는가. 빈 파일은 없는 것으로 친다.
 *
 * 크기만 보지 않고 읽어서 본다. 공백뿐인 파일을 yt-dlp 에 넘기면 연령 제한 재시도를
 * 한 번 더 헛되이 쓴다. 파일이 몇 킬로바이트고 물어보는 빈도도 낮아 읽는 값이 아깝지 않다.
 */
function cookiesReady() {
  try {
    return fs.readFileSync(cookiesPath(), "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 쿠키를 갈아 끼운다. 빈 글이면 지운다.
 *
 * 줄바꿈만 맞추고 내용은 손대지 않는다. Netscape 형식은 탭으로 칸을 나누는데, 브라우저
 * 확장에서 복사해 붙여넣어도 탭은 그대로 온다(실측). 그래서 검사할 것이 없다.
 * 들어 있는 쿠키가 아직 살아 있는지는 우리가 알 수 없다. 유튜브가 브라우저 쪽에서
 * 세션을 돌리면 만료 시각과 무관하게 무효가 되므로, 써 보기 전에는 판정이 불가능하다.
 */
function saveCookies(text: unknown): boolean {
  const body = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!body) return clearCookies();

  // 같은 폴더에 쓰고 옮긴다. 쓰는 도중의 반쪽짜리 파일을 yt-dlp 가 읽으면 안 된다
  const temp = `${cookiesPath()}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${body}\n`);
  fs.renameSync(temp, cookiesPath());
  log.info(`설정을 저장했습니다: ${COOKIES_FILE}`);
  return true;
}

/** 쿠키를 치운다. 빈 파일을 남기지 않는다. 있음과 비어 있음을 구별할 일이 없게. */
function clearCookies() {
  try {
    fs.unlinkSync(cookiesPath());
    log.info(`설정을 지웠습니다: ${COOKIES_FILE}`);
  } catch {
    /* 원래 없었다 */
  }
  return false;
}

const exported = { cookiesPath, cookiesReady, saveCookies, clearCookies };
export default exported;
export { exported as "module.exports" };
