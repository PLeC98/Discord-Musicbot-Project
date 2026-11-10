// 백업 불러오기에 올린 파일. 미리 보기 전에 청크로 올려(dashboard/uploads) database/tmp/archive-<토큰>.zip에 두고, 불러오기는 그 토큰으로 쓴다(수백 MB인 파일을 두 번 올리지 않게).
// 토큰은 업로드 id다. 받는 동안은 archive-<토큰>.zip.part다. 불러오거나 닫으면 삭제하고, 1시간이 지나도 삭제한다. 봇이 켜질 때 남은 것을 치운다(꺼지기 전에 올린 것)

import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../infra/project-paths.ts";
import { roomIn } from "../infra/disk.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { Target } from "./uploads.ts";
const log = logger.child({ category: "dashboard" });

const PREFIX = "archive-";
const TOKEN = /^[0-9a-f]{32}$/;
/** 올린 파일을 두는 시간 */
const KEEP_MS = 60 * 60_000;

let dir = path.join(PROJECT.database, "tmp");
const uploads = new Map<string, NodeJS.Timeout>();

const fileFor = (token: string) => path.join(dir, `${PREFIX}${token}.zip`);

/** 업로드 파일을 받는 동안 쓸 위치(업로드 id를 붙인 .part)와 그 드라이브의 남은 공간 */
function targetFor(id: string): Target {
  fs.mkdirSync(dir, { recursive: true });
  const file = `${fileFor(id)}.part`;
  return { file, room: () => roomIn(dir), discard: () => fs.rmSync(file, { force: true }), ref: id };
}

/** 다 받은 업로드를 토큰으로 등록한다(.part를 원래 이름으로 바꾸고 1시간 뒤 삭제를 예약한다). 받은 파일 */
function adopt(id: string): string {
  const file = fileFor(id);
  fs.renameSync(`${file}.part`, file);
  const timer = setTimeout(() => drop(id), KEEP_MS);
  timer.unref();
  uploads.set(id, timer);
  return file;
}

/** 그 토큰의 파일(없거나 지났으면 null) */
const fileOf = (token: string) => (TOKEN.test(token) && uploads.has(token) && fs.existsSync(fileFor(token)) ? fileFor(token) : null);

/** 올린 파일을 삭제하고 타이머를 멈춘다. 모르는 토큰은 무시한다 */
function drop(token: string) {
  if (!TOKEN.test(token) || !uploads.has(token)) return;
  clearTimeout(uploads.get(token));
  uploads.delete(token);
  fs.rmSync(fileFor(token), { force: true });
}

/** 봇이 켜질 때: 이전 실행이 남긴 업로드 파일을 모두 삭제한다 */
function sweepUploads() {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.debug(`업로드된 백업 임시 파일 정리 실패: ${messageOf(error)}`);
    return;
  }
  for (const name of names) if (name.startsWith(PREFIX)) fs.rmSync(path.join(dir, name), { force: true });
}

/** 테스트: 다른 폴더를 쓴다 */
function _useDir(folder: string) {
  dir = folder;
}

export { targetFor, adopt, fileOf, drop, sweepUploads, _useDir };
