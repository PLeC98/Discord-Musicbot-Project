// 유튜브 쿠키(로그인된 세션 그 자체). 비밀 표(store/secrets)에 암호화해 두고, yt-dlp 를 한 번 돌릴 때만 파일로 푼다.
//
// yt-dlp 는 `--cookies FILE` 을 읽고 끝나면서 고친 쿠키를 그 파일에 되쓴다. 그래서 실행마다 따로 파일을 주고(checkout),
// 끝나면 바뀐 내용을 되담은 뒤 파일을 지운다(release). 그사이 대시보드에서 새 쿠키를 넣었으면 되담지 않는다(새것을 옛것으로 덮지 않게).
// 파일은 봇 전용 임시 폴더(database/tmp)에 본인만 읽게(0600) 둔다. Windows 는 이 비트를 안 보고 사용자 폴더 권한을 따른다.
// 꺼지다 남은 파일은 기동 때 치운다(sweep).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });
import { PROJECT } from "../infra/project-paths.ts";
import * as secrets from "./secrets.ts";
import { settingsDb } from "./settings-db.ts";

const NAME = "youtube.cookies";
const PREFIX = "cookies-";
/** yt-dlp 옵션의 cookies 칸에 이 값이 오면 실행 때 파일로 풀어 바꾼다(sources/youtube/ytdlp-run) */
const JAR = "cookie-jar:youtube";

// 파일을 둘 곳. 시험이 갈아끼운다
let dir = path.join(PROJECT.database, "tmp");

// 줄바꿈만 맞추고 내용은 손대지 않는다(Netscape 형식은 탭으로 칸을 나눈다. 브라우저 확장에서 붙여넣어도 탭은 그대로 온다)
const normalize = (text: unknown) =>
  String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();

/** 갈아 끼운다. 빈 글이면 지운다. 저장했으면 true */
function save(text: unknown): boolean {
  const body = normalize(text);
  if (!body) {
    secrets.remove(NAME);
    return false;
  }
  secrets.put(NAME, `${body}\n`);
  return true;
}

/**
 * 쓸 수 있는 쿠키가 있는가(넣었고 지금 키로 풀린다).
 * DB 를 열기 전(기동 전 · 시험)에는 없는 것으로 본다. 곡 찾기 실패의 안내에도 쓰는 판정이라 던지면 원래 오류를 덮는다
 */
function ready() {
  return settingsDb.isOpen() && secrets.read(NAME).state === "ok";
}

/** 실행 하나에 줄 쿠키 파일. 쿠키가 없으면 null */
function checkout(): { file: string; text: string; since: number | null } | null {
  const got = secrets.read(NAME);
  if (got.state !== "ok") return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${PREFIX}${process.pid}-${crypto.randomBytes(6).toString("hex")}.txt`);
  fs.writeFileSync(file, got.value, { flag: "wx", mode: 0o600 });
  return { file, text: got.value, since: secrets.status(NAME).updatedAt };
}

/** 실행이 끝났다. yt-dlp 가 고친 쿠키를 되담고(그사이 새로 넣은 것이 없을 때만) 파일을 지운다 */
function release(held: { file: string; text: string; since: number | null }) {
  try {
    const now = fs.readFileSync(held.file, "utf8");
    if (normalize(now) && normalize(now) !== normalize(held.text) && secrets.status(NAME).updatedAt === held.since) save(now);
  } catch {
    /* 읽지 못했으면 되담지 않는다. 쿠키는 그대로다 */
  } finally {
    fs.rmSync(held.file, { force: true });
  }
}

/** 꺼지다 남은 쿠키 파일을 치운다. 기동 때 한 번 */
function sweep() {
  let left: string[];
  try {
    left = fs.readdirSync(dir).filter((name) => name.startsWith(PREFIX));
  } catch {
    return; // 폴더가 없다
  }
  for (const name of left) fs.rmSync(path.join(dir, name), { force: true });
  if (left.length) log.info(`지난 실행이 남긴 쿠키 파일 ${left.length}개를 지웠습니다`);
}

/** 옛 쿠키 파일(config/cookies.txt)이 남아 있으면 기동 때 한 줄. 읽지도 지우지도 않는다 */
function warnLegacyFile(configDir = PROJECT.config) {
  const file = path.join(configDir, "cookies.txt");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    log.warn("config/cookies.txt 는 이제 읽지 않습니다. 운영자 패널의 API · 쿠키 탭에서 쿠키를 다시 넣고 이 파일은 지우세요");
  }
}

// 시험 시임. 파일을 둘 곳을 바꾼다
function _setDir(next: string) {
  dir = next;
}

export { save, ready, checkout, release, sweep, warnLegacyFile, JAR, _setDir };
