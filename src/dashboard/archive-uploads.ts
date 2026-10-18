// 백업 불러오기에 올린 파일. 미리 보기 때 한 번 올려 database/tmp/archive-<토큰>.zip 에 두고, 가져오기는 그 토큰으로 쓴다(수백 MB 인 파일을 두 번 올리지 않게).
// 가져오거나 닫으면 삭제하고, 1시간이 지나도 삭제한다. 봇이 켜질 때 남은 것을 치운다(꺼지기 전에 올린 것)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { PROJECT } from "../infra/project-paths.ts";
import { roomIn } from "../infra/disk.ts";
import { saveBody, type Saved } from "./body-to-file.ts";

const PREFIX = "archive-";
const TOKEN = /^[0-9a-f]{32}$/;
/** 올린 파일을 두는 시간 */
const KEEP_MS = 60 * 60_000;

let dir = path.join(PROJECT.database, "tmp");
const uploads = new Map<string, NodeJS.Timeout>();

const fileFor = (token: string) => path.join(dir, `${PREFIX}${token}.zip`);

/** 올린 파일을 받는다. 받았으면 토큰, 못 받았으면 까닭과 남은 공간 */
async function receive(req: Request): Promise<(Saved & { ok: false; room: number }) | { ok: true; token: string; file: string; bytes: number }> {
  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(16).toString("hex");
  const file = fileFor(token);
  const room = roomIn(dir);
  const saved = await saveBody(req, file, room);
  if (!saved.ok) return { ...saved, room };
  const timer = setTimeout(() => drop(token), KEEP_MS);
  timer.unref();
  uploads.set(token, timer);
  return { ok: true, token, file, bytes: saved.bytes };
}

/** 그 토큰의 파일(없거나 지났으면 null) */
const fileOf = (token: string) => (TOKEN.test(token) && uploads.has(token) && fs.existsSync(fileFor(token)) ? fileFor(token) : null);

/** 삭제한다 */
function drop(token: string) {
  if (!TOKEN.test(token)) return;
  clearTimeout(uploads.get(token));
  uploads.delete(token);
  fs.rmSync(fileFor(token), { force: true });
}

/** 봇이 켜질 때: 남은 것을 치운다 */
function sweepUploads() {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) if (name.startsWith(PREFIX)) fs.rmSync(path.join(dir, name), { force: true });
}

/** 테스트: 다른 폴더를 쓴다 */
function _useDir(folder: string) {
  dir = folder;
}

export { receive, fileOf, drop, sweepUploads, _useDir };
