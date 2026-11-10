// 전체 백업(봇 폴더의 명령 `pnpm run backup`). .env, 설정 DB, 파비콘, 로그인 배경을 ZIP 하나로 묶는다. 봇을 다른 폴더, 다른 기기로 옮길 때,
// 받은 ZIP 을 (봇을 끈 채) 봇 폴더에 풀어 덮어쓰면 끝난다. 평문 .env 가 들어가니 대시보드에는 이 길이 없다(봇 폴더를 쓸 수 있는 사람만).
//
// 설정 DB 는 database/settings.db 가 아니라 database/settings.restore.db 로 담는다. 다음 기동이 지금 것을 스냅샷으로 남기고 교체한다
// (store/snapshots). 풀어서 settings.db 를 덮으면 그 폴더에 남은 -wal 이 새 파일에 얹혀 깨질 수 있다.
// 로그인 배경은 대시보드의 로그인 배경 내보내기와 같은 것(다 만든 배경, index.json)을 저장 위치 그대로 담는다. 풀어 덮어쓰면 그 봇에 있던 배경 폴더는
// 새 index.json 에 없어 다음 기동이 치운다(배경을 한 번도 쓰지 않은 봇이면 담지 않는다). 봇이 켜져 있어도 되게 기록은 읽기만 한다(봇의 기록 읽기는 목록에 없는 폴더를 삭제하는데, 그건 켜진 봇이 업로드 받는 중인 폴더일 수 있다).
// 오디오 캐시는 대시보드의 오디오 캐시 내보내기와 같은 ZIP 을 database/audio-cache.restore.zip 으로 담는다(기본은 캐시 파일 없이, withAudio 면 캐시 파일까지).
// 다음 기동이 대시보드 불러오기와 같은 합치기로 불러오고 삭제한다(settings-archive 의 applyStagedAudio). cache.db 는 한 시점 사본을 열어 읽는다.
// 이 프로세스의 캐시 파일 보호는 켜진 봇의 퇴거를 막지 못하므로, 그 사이 퇴거로 지워진 캐시 파일은 건너뛴다(행 목록에서도 빠진다).
// 수 GB 가 될 수 있어 스트리밍으로 쓴다. 만든 파일은 database/full-backups/ 에 하나만 둔다(평문 토큰이 든 파일이 쌓이지 않게). 다 쓴 뒤에 이전 것을 삭제한다.
// 쓰는 동안의 파일은 <최종 이름>.<pid>.<무작위>.part 다. 백업을 시작할 때 만든 프로세스가 죽었다고 확인된 것만 삭제한다(겹쳐 도는 다른 백업의 것은 건드리지 않는다).
// 다 쓴 .part는 하드링크로 최종 이름에 올린다(이름이 이미 있으면 실패해 번호를 붙인다). 하드링크를 쓸 수 없는 파일 시스템(FAT32, exFAT)이면 이름을 바꾼다

import crypto from "crypto";
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
import { dropWal } from "../store/snapshots.ts";
import { codeOf } from "../rules/error-kind.ts";

type Paths = { envFile: string; databaseDir: string; faviconDir: string; backgroundDir: string; outDir: string };
const REAL: Paths = {
  envFile: PROJECT.env,
  databaseDir: PROJECT.database,
  faviconDir: path.join(PROJECT.dashboardData, "favicon"),
  backgroundDir: path.join(PROJECT.dashboardData, "login-background"),
  outDir: path.join(PROJECT.database, "full-backups"),
};

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: Date) => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
/** 쓰는 중인 백업(만든 프로세스의 pid). 옛 형식(<이름>.zip.part)은 pid가 없다 */
const PART = /^musicbot-full-.+\.zip\.(\d+)\.[0-9a-f]+\.part$/;
const LEGACY_PART = /^musicbot-full-.+\.zip\.part$/;
/** 같은 초의 백업에 번호를 붙여 볼 횟수 */
const NAME_TRIES = 20;

const partOf = (out: string) => `${out}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.part`;

/** pid의 프로세스가 끝났다고 확인됐다(ESRCH). 살아 있거나 권한이 없어(EPERM) 모르면 false */
function processGone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return codeOf(error) === "ESRCH";
  }
}

/**
 * 끝난 프로세스가 남긴 .part(평문 .env가 들어 있을 수 있다)를 삭제한다. 삭제하지 못하면 다음 백업이 다시 한다.
 * 옛 형식은 쓰는 프로세스를 알 수 없어 남기고 이름을 돌려준다(ZIP을 쓰는 동안 큰 입력 하나를 읽느라 오래 안 바뀔 수 있어 시각으로도 판단하지 않는다)
 */
function sweepParts(outDir: string): string[] {
  const names = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  for (const name of names) {
    const pid = PART.exec(name)?.[1];
    if (pid && processGone(Number(pid))) fs.rmSync(path.join(outDir, name), { force: true, maxRetries: 2 });
  }
  return names.filter((name) => LEGACY_PART.test(name));
}

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
  // 풀어 둔 사본을 읽기 전용으로 열 때 -wal, -shm이 생기지 않게 한다
  dropWal(temp);
  return { file: temp, done };
}

/**
 * 다 쓴 ZIP을 최종 이름에 올리고 그 경로를 돌려준다. 이름이 있으면 -2, -3을 붙인다. 하드링크는 이름이 있으면 실패해 겹쳐 도는 백업끼리 덮지 않는다.
 * 올리지 못하면 .part를 삭제한다(.env의 비밀값이 평문으로 들어 있어 남기지 않는다)
 */
function publish(part: string, dir: string, name: string): string {
  try {
    for (let n = 1; n <= NAME_TRIES; n++) {
      const out = path.join(dir, n > 1 ? name.replace(/\.zip$/, `-${n}.zip`) : name);
      try {
        fs.linkSync(part, out);
      } catch (error) {
        if (codeOf(error) === "EEXIST" || fs.existsSync(out)) continue;
        // 하드링크를 쓸 수 없는 파일 시스템(FAT32, exFAT). 있는지 본 뒤 바꾸는 사이에 겹쳐 도는 백업이 그 이름에 올렸으면 덮는다.
        // 덮는 것도 덮이는 것도 온전한 백업이라 받아들인다(덮지 않는 이름 바꾸기가 없고, 복사는 수 GB를 다시 쓴다)
        fs.renameSync(part, out);
        return out;
      }
      removeLeftPart(part);
      return out;
    }
    throw new Error(`백업 이름 잡기 실패: ${name}부터 ${NAME_TRIES}개가 이미 있음`);
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }
}

// 하드링크로 올린 뒤의 .part. 삭제하지 못하면 남는다(이 프로세스가 끝나면 다음 백업이 삭제한다)
function removeLeftPart(part: string) {
  try {
    fs.rmSync(part, { force: true });
  } catch {
    /* 다음 백업의 sweepParts 가 삭제한다 */
  }
}

// 파일로 스트리밍해 쓴다(옆 이름에 쓰고 다 쓰면 바꾼다. 실패하면 삭제한다)
async function writeTo(out: string, inputs: ZipInput[]) {
  const part = partOf(out);
  const stream = fs.createWriteStream(part, { mode: 0o600, flags: "wx" });
  // 열기, 쓰기 실패는 error 로 온다. 듣지 않으면 잡히지 않은 예외로 끝나고, 쓰는 쪽은 "닫혔다"만 받는다
  let failed: Error | null = null;
  stream.on("error", (error) => (failed ??= error));
  try {
    await writeZip(inputs, sinkOf(stream));
    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    stream.destroy();
    // 이름이 이미 있어 열지 못했으면(EEXIST) 그 파일은 다른 백업의 것이다
    if (codeOf(failed) !== "EEXIST") fs.rmSync(part, { force: true });
    throw failed ?? error;
  }
  return part;
}

// 오디오 캐시 번들. cache.db 사본을 열어 오디오 캐시 내보내기와 같은 ZIP 을 임시 폴더에 쓴다. cache.db 가 없으면 null.
// 이 프로세스가 그 cache.db 를 이미 열었으면(봇 안, 테스트) 그것을 그대로 읽는다(내보내는 동안의 캐시 파일 보호도 걸린다). 다른 파일을 열어 두었으면 던진다(캐시 DB 는 프로세스에 하나다)
async function audioBundle(databaseDir: string, withFiles: boolean): Promise<{ file: string; files: number; done: () => void } | null> {
  const cache = path.join(databaseDir, "cache.db");
  if (!fs.existsSync(cache)) return null;
  const opened = cacheDb.isOpen();
  if (opened && path.resolve(cacheDb.get().name) !== path.resolve(cache)) throw Object.assign(new Error(`다른 캐시 DB 가 열려 있음: ${cacheDb.get().name}`), { code: "CACHE_DB_OPEN" });
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
 * 전체 백업 ZIP을 만든다. file: 만든 ZIP, replaced: 삭제한 이전 백업, left: 삭제하지 못한 이전 백업(다른 프로그램이 열어 둠 등), hasEnv: .env 포함 여부, favicons, backgrounds: 담은 파비콘 파일과 로그인 배경 수, audioFiles: 담은 캐시 파일 수(오디오 캐시가 없으면 null),
 * legacyParts: 남아 있는 옛 형식의 중단된 백업(쓰는 프로세스를 알 수 없어 삭제하지 않았다), tempLeft: 삭제하지 못한 임시 사본 폴더
 * @param withAudio  오디오 캐시 번들에 캐시 파일까지(기본은 행 목록만)
 */
async function makeFullBackup(paths: Partial<Paths> = {}, at = new Date(), { withAudio = false }: { withAudio?: boolean } = {}) {
  const { envFile, databaseDir, faviconDir, backgroundDir, outDir } = { ...REAL, ...paths };
  const settings = path.join(databaseDir, "settings.db");
  if (!fs.existsSync(settings)) throw Object.assign(new Error(`설정 DB 없음: ${settings}`), { code: "NO_SETTINGS_DB" });
  const name = `musicbot-full-${stamp(at)}.zip`;
  const legacyParts = sweepParts(outDir);
  // .env는 지금 한 번 읽어 ZIP의 마지막 항목으로 넣는다(평문이 .part에 머무는 시간이 짧고, 긴 백업 도중 바뀐 파일을 뒤늦게 읽지 않는다)
  const env = fs.existsSync(envFile) ? fs.readFileSync(envFile) : null;
  const hasEnv = env !== null;
  const favicons = fs.existsSync(faviconDir) ? fs.readdirSync(faviconDir).filter(isFaviconFile) : [];
  // 로그인 배경을 한 번도 쓰지 않은 봇이면 담지 않는다(풀어 덮어쓸 봇의 배경을 빈 기록으로 삭제하지 않게)
  const state = readIndex(backgroundDir);
  const background = fs.existsSync(path.join(backgroundDir, "index.json")) ? exportInputs({ state, folderOf: (id) => path.join(backgroundDir, id), prefix: "database/dashboard/" }) : [];
  const audio = await audioBundle(databaseDir, withAudio);
  const copy = await dbCopy(settings).catch((error: unknown) => {
    audio?.done();
    throw error;
  });
  const inputs: ZipInput[] = [{ name: "database/settings.restore.db", file: copy.file }, { name: "database/settings.restore.db.json", data: Buffer.from(JSON.stringify({ from: `전체 백업 ${name}` })) }, ...(audio ? [{ name: `database/${archive.STAGED_AUDIO}`, file: audio.file }] : []), ...favicons.map((one) => ({ name: `database/dashboard/favicon/${one}`, file: path.join(faviconDir, one) })), ...background, ...(env ? [{ name: ".env", data: env }] : [])];

  fs.mkdirSync(outDir, { recursive: true });
  let part: string;
  let tempLeft: string[];
  try {
    part = await writeTo(path.join(outDir, name), inputs);
  } finally {
    tempLeft = removeTemps([copy, audio]);
  }
  const { out, replaced, left } = replaceEarlier(part, outDir, name);
  return { file: out, replaced, left, hasEnv, favicons: favicons.length, backgrounds: state.items.filter(isReady).length, audioFiles: audio ? audio.files : null, legacyParts, tempLeft };
}

// 임시 사본을 삭제한다. 삭제하지 못해도 백업은 계속하고, 남은 폴더를 돌려준다(부르는 쪽이 알린다)
function removeTemps(temps: Array<{ file: string; done: () => void } | null>): string[] {
  const left: string[] = [];
  for (const temp of temps) {
    try {
      temp?.done();
    } catch {
      if (temp) left.push(path.dirname(temp.file));
    }
  }
  return left;
}

/**
 * 새 백업을 제자리에 둔 뒤 이전 백업을 삭제한다(그사이 멈춰도 백업이 하나는 남는다). 삭제하지 못한 것은 남기고 알린다(left).
 * 올리기 전에 실패하면 평문 .env 가 든 .part 를 삭제한다
 */
function replaceEarlier(part: string, outDir: string, name: string) {
  let earlier: string[];
  try {
    earlier = fs.readdirSync(outDir).filter((one) => /^musicbot-full-.*\.zip$/.test(one));
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw error;
  }
  const out = publish(part, outDir, name);
  ownerOnly(out);
  // 목록을 읽은 뒤 겹쳐 도는 백업이 그 이름을 비워 이 백업이 그 이름에 올라갔으면 목록에서 뺀다
  const others = earlier.filter((one) => path.join(outDir, one) !== out);
  const left: string[] = [];
  for (const old of others) {
    try {
      fs.rmSync(path.join(outDir, old), { force: true });
    } catch {
      left.push(old);
    }
  }
  return { out, replaced: others.filter((one) => !left.includes(one)), left };
}

export { makeFullBackup };
