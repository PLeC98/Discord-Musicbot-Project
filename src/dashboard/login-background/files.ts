// 다 만든 배경의 폴더에 남는 파일의 형식: 정지 그림(still-<폭>.webp) · 코덱마다 목록(<코덱>/index.m3u8) · 단계마다 목록 · init · 조각(<코덱>/<짧은 변>/…).
// 공개 경로가 내는 파일이고, 백업이 담고 받는 파일이다(받은 문자열을 경로로 그대로 쓰지 않게 이 형식만)

import fs from "node:fs";
import path from "node:path";
import logger from "../../infra/log/logger.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import { LOGIN_BG_CODECS, type LoginBackgroundCodec } from "../contract/login-background.ts";
const log = logger.child({ category: "dashboard" });

const STILL_FILE = /^still-(\d{2,4})\.webp$/;
/** 단계 폴더(짧은 변) · 단계 안의 파일 */
const SHORT = /^\d{2,4}$/;
const RUNG_FILE = /^(index\.m3u8|init\.mp4|seg-\d{3,6}\.m4s)$/;
const PLAYLIST = "index.m3u8";

const isCodec = (value: string): value is LoginBackgroundCodec => LOGIN_BG_CODECS.some((codec) => codec === value);

/** 배경 폴더 안의 경로(/ 로 나눈 조각)가 내는 파일의 형식인가 */
function isServed(parts: string[]): boolean {
  if (parts.length === 1) return STILL_FILE.test(parts[0]);
  if (parts.length === 2) return isCodec(parts[0]) && parts[1] === PLAYLIST;
  return parts.length === 3 && isCodec(parts[0]) && SHORT.test(parts[1]) && RUNG_FILE.test(parts[2]);
}

/** 폴더에 있는 내는 파일(/ 로 나눈 경로). 그 밖의 것(원본 · 임시 파일)은 뺀다 */
function servedFiles(folder: string): string[] {
  const found: string[] = [];
  const walk = (parts: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(folder, ...parts), { withFileTypes: true });
    } catch (error) {
      if (codeOf(error) !== "ENOENT") log.debug(`로그인 배경 파일 목록 읽기 실패(${path.join(folder, ...parts)}): ${messageOf(error)}`);
      return;
    }
    for (const entry of entries) {
      const next = [...parts, entry.name];
      if (entry.isDirectory() && next.length < 3) walk(next);
      else if (entry.isFile() && isServed(next)) found.push(next.join("/"));
    }
  };
  walk([]);
  return found.sort();
}

export { STILL_FILE, SHORT, RUNG_FILE, PLAYLIST, isCodec, isServed, servedFiles };
