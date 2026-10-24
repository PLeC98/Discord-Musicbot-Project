// 전체 백업(봇 폴더의 명령 `pnpm run backup`). .env · 설정 DB · 파비콘 · 로그인 배경을 ZIP 하나로 묶는다. 봇을 다른 폴더 · 다른 기기로 옮길 때,
// 받은 ZIP 을 (봇을 끈 채) 봇 폴더에 풀어 덮어쓰면 끝난다. 평문 .env 가 들어가니 대시보드에는 이 길이 없다(봇 폴더를 쓸 수 있는 사람만).
//
// 설정 DB 는 database/settings.db 가 아니라 database/settings.restore.db 로 담는다. 다음 기동이 지금 것을 스냅샷으로 남기고 교체한다
// (store/snapshots). 풀어서 settings.db 를 덮으면 그 폴더에 남은 -wal 이 새 파일에 얹혀 깨질 수 있다.
// 로그인 배경은 대시보드의 로그인 배경 내보내기와 같은 것(다 만든 배경 · index.json)을 저장 위치 그대로 담는다. 풀어 덮어쓰면 그 봇에 있던 배경 폴더는
// 새 index.json 에 없어 다음 기동이 치운다(배경을 한 번도 쓰지 않은 봇이면 담지 않는다). 봇이 켜져 있어도 되게 기록은 읽기만 한다(봇의 기록 읽기는 목록에 없는 폴더를 삭제하는데, 그건 켜진 봇이 올려 받는 중인 폴더일 수 있다).
// 오디오 캐시는 대시보드의 오디오 캐시 내보내기와 같은 ZIP 을 database/audio-cache.restore.zip 으로 담는다(기본은 캐시 파일 없이, withAudio 면 캐시 파일까지).
// 다음 기동이 대시보드 불러오기와 같은 합치기로 불러오고 삭제한다(settings-archive 의 applyStagedAudio). cache.db 는 한 시점 사본을 열어 읽고,
// 켜진 봇의 지킴이 이 프로세스에 닿지 않아 그새 퇴거가 지운 캐시 파일은 건너뛴다(행 목록에서도 빠진다).
// 수 GB 가 될 수 있어 스트리밍으로 쓴다. 만든 파일은 database/full-backups/ 에 하나만 둔다(평문 토큰이 든 파일이 쌓이지 않게). 다 쓴 뒤에 이전 것을 삭제한다

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { sinkOf, writeZip, type ZipInput } from "../infra/zip.ts";
import { ownerOnly } from "../infra/owner-only.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { isFaviconFile } from "../dashboard/appearance.ts";
import { isReady, readIndex } from "../dashboard/login-background/store.ts";
import { exportInputs } from "../dashboard/login-background/archive.ts";
import * as archive from "../dashboard/settings-archive.ts";
import { cacheDb } from "../store/cache-db.ts";

type Paths = { envFile: string; databaseDir: string; faviconDir: string; backgroundDir: string; outDir: string };
const REAL: Paths = {
  envFile: PROJECT.env,
  databaseDir: PROJECT.database,
  faviconDir: path.join(PROJECT.dashboardData, "favicon"),
  backgroundDir: path.join(PROJECT.dashboardData, "login-background"),
  outDir: path.join(PROJECT.database, "full-backups"),
};

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: Date) => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;

// 켜져 있는 봇이 쓰는 중이어도 한 시점의 사본(SQLite 백업). 다 쓰면 삭제한다
async function dbCopy(file: string): Promise<{ file: string; done: () => void }> {
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-backup-")), path.basename(file));
  const done = () => fs.rmSync(path.dirname(temp), { recursive: true, force: true });
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    await db.backup(temp);
  } catch (error) {
    done();
    throw error;
  } finally {
    db.close();
  }
  return { file: temp, done };
}

// 파일로 스트리밍해 쓴다(옆 이름에 쓰고 다 쓰면 바꾼다. 실패하면 삭제한다)
async function writeTo(out: string, inputs: ZipInput[]) {
  const part = `${out}.part`;
  const stream = fs.createWriteStream(part, { mode: 0o600 });
  // 열기 · 쓰기 실패는 error 로 온다. 듣지 않으면 잡히지 않은 예외로 끝나고, 쓰는 쪽은 "닫혔다"만 받는다
  let failed: Error | null = null;
  stream.on("error", (error) => (failed ??= error));
  try {
    await writeZip(inputs, sinkOf(stream));
    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    stream.destroy();
    fs.rmSync(part, { force: true });
    throw failed ?? error;
  }
  return part;
}

// 오디오 캐시 번들. cache.db 사본을 열어 오디오 캐시 내보내기와 같은 ZIP 을 임시 폴더에 쓴다. cache.db 가 없으면 null.
// 이 프로세스가 그 cache.db 를 이미 열었으면(봇 안 · 테스트) 그것을 그대로 읽는다(내보내는 동안의 지킴도 걸린다). 다른 파일을 열어 두었으면 던진다(캐시 DB 는 프로세스에 하나다)
async function audioBundle(databaseDir: string, withFiles: boolean): Promise<{ file: string; files: number; done: () => void } | null> {
  const cache = path.join(databaseDir, "cache.db");
  if (!fs.existsSync(cache)) return null;
  const opened = cacheDb.isOpen();
  if (opened && path.resolve(cacheDb.get().name) !== path.resolve(cache)) throw Object.assign(new Error(`다른 캐시 DB 가 열려 있습니다: ${cacheDb.get().name}`), { code: "CACHE_DB_OPEN" });
  const copy = opened ? { file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-backup-")), "cache.db"), done: () => undefined } : await dbCopy(cache);
  const folder = path.dirname(copy.file);
  const done = () => {
    copy.done();
    fs.rmSync(folder, { recursive: true, force: true });
  };
  try {
    if (!opened) cacheDb.open(copy.file);
    const out = path.join(folder, archive.STAGED_AUDIO);
    const { inputs, release } = archive.build("audio-cache", { withFiles });
    try {
      fs.renameSync(await writeTo(out, inputs), out);
    } finally {
      release();
    }
    return { file: out, files: inputs.filter((one) => "file" in one && fs.existsSync(one.file)).length, done };
  } catch (error) {
    done();
    throw error;
  } finally {
    if (!opened) cacheDb.close();
  }
}

/**
 * 만든다. file: 만든 ZIP, replaced: 삭제한 이전 백업, hasEnv: .env 를 담았나, favicons · backgrounds: 담은 파비콘 파일 · 로그인 배경 수, audioFiles: 담은 캐시 파일 수(오디오 캐시가 없으면 null)
 * @param withAudio  오디오 캐시 번들에 캐시 파일까지(기본은 행 목록만)
 */
async function makeFullBackup(paths: Partial<Paths> = {}, at = new Date(), { withAudio = false }: { withAudio?: boolean } = {}) {
  const { envFile, databaseDir, faviconDir, backgroundDir, outDir } = { ...REAL, ...paths };
  const settings = path.join(databaseDir, "settings.db");
  if (!fs.existsSync(settings)) throw Object.assign(new Error(`설정 DB 가 없습니다: ${settings}`), { code: "NO_SETTINGS_DB" });
  const name = `musicbot-full-${stamp(at)}.zip`;
  const hasEnv = fs.existsSync(envFile);
  const favicons = fs.existsSync(faviconDir) ? fs.readdirSync(faviconDir).filter(isFaviconFile) : [];
  // 로그인 배경을 한 번도 쓰지 않은 봇이면 담지 않는다(풀어 덮어쓸 봇의 배경을 빈 기록으로 삭제하지 않게)
  const state = readIndex(backgroundDir);
  const background = fs.existsSync(path.join(backgroundDir, "index.json")) ? exportInputs({ state, folderOf: (id) => path.join(backgroundDir, id), prefix: "database/dashboard/" }) : [];
  const audio = await audioBundle(databaseDir, withAudio);
  const copy = await dbCopy(settings).catch((error: unknown) => {
    audio?.done();
    throw error;
  });
  const inputs: ZipInput[] = [...(hasEnv ? [{ name: ".env", file: envFile }] : []), { name: "database/settings.restore.db", file: copy.file }, { name: "database/settings.restore.db.json", data: Buffer.from(JSON.stringify({ from: `전체 백업 ${name}` })) }, ...(audio ? [{ name: `database/${archive.STAGED_AUDIO}`, file: audio.file }] : []), ...favicons.map((one) => ({ name: `database/dashboard/favicon/${one}`, file: path.join(faviconDir, one) })), ...background];

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, name);
  let part: string;
  try {
    part = await writeTo(out, inputs);
  } finally {
    copy.done();
    audio?.done();
  }
  const replaced = fs.readdirSync(outDir).filter((one) => /^musicbot-full-.*\.zip$/.test(one));
  for (const old of replaced) fs.rmSync(path.join(outDir, old), { force: true });
  fs.renameSync(part, out);
  ownerOnly(out);
  return { file: out, replaced, hasEnv, favicons: favicons.length, backgrounds: state.items.filter(isReady).length, audioFiles: audio ? audio.files : null };
}

export { makeFullBackup };
