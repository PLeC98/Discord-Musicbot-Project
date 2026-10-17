// 전체 백업(봇 폴더의 명령 `pnpm run backup`). .env · 설정 DB · 파비콘 · 로그인 배경을 ZIP 하나로 묶는다. 봇을 다른 폴더 · 다른 기기로 옮길 때,
// 받은 ZIP 을 (봇을 끈 채) 봇 폴더에 풀어 덮어쓰면 끝난다. 평문 .env 가 들어가니 대시보드에는 이 길이 없다(봇 폴더를 쓸 수 있는 사람만).
//
// 설정 DB 는 database/settings.db 가 아니라 database/settings.restore.db 로 담는다. 다음 기동이 지금 것을 스냅샷으로 남기고 바꿔 끼운다
// (store/snapshots). 풀어서 settings.db 를 덮으면 그 폴더에 남은 -wal 이 새 파일에 얹혀 깨질 수 있다.
// 로그인 배경은 대시보드의 로그인 배경 내보내기와 같은 것(다 만든 배경 · index.json)을 저장 자리 그대로 담는다. 풀어 덮어쓰면 그 봇에 있던 배경 폴더는
// 새 index.json 에 없어 다음 기동이 치운다(배경을 한 번도 쓰지 않은 봇이면 담지 않는다). 봇이 켜져 있어도 되게 기록은 읽기만 한다(봇의 기록 읽기는 목록에 없는 폴더를 지우는데, 그건 켜진 봇이 올려 받는 중인 폴더일 수 있다).
// 수 GB 가 될 수 있어 흘려 쓴다. 만든 파일은 database/full-backups/ 에 하나만 둔다(평문 토큰이 든 파일이 쌓이지 않게). 다 쓴 뒤에 이전 것을 지운다

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

// 켜져 있는 봇이 쓰는 중이어도 한 시점의 사본(SQLite 백업). 다 쓰면 지운다
async function settingsCopy(file: string): Promise<{ file: string; done: () => void }> {
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-backup-")), "settings.db");
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

// 파일로 흘려 쓴다(옆 이름에 쓰고 다 쓰면 바꾼다. 실패하면 지운다)
async function writeTo(out: string, inputs: ZipInput[]) {
  const part = `${out}.part`;
  const stream = fs.createWriteStream(part, { mode: 0o600 });
  try {
    await writeZip(inputs, sinkOf(stream));
    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    stream.destroy();
    fs.rmSync(part, { force: true });
    throw error;
  }
  return part;
}

/** 만든다. file: 만든 ZIP, replaced: 지운 이전 백업, hasEnv: .env 를 담았나, favicons · backgrounds: 담은 파비콘 파일 · 로그인 배경 수 */
async function makeFullBackup(paths: Partial<Paths> = {}, at = new Date()) {
  const { envFile, databaseDir, faviconDir, backgroundDir, outDir } = { ...REAL, ...paths };
  const settings = path.join(databaseDir, "settings.db");
  if (!fs.existsSync(settings)) throw Object.assign(new Error(`설정 DB 가 없습니다: ${settings}`), { code: "NO_SETTINGS_DB" });
  const name = `musicbot-full-${stamp(at)}.zip`;
  const hasEnv = fs.existsSync(envFile);
  const favicons = fs.existsSync(faviconDir) ? fs.readdirSync(faviconDir).filter(isFaviconFile) : [];
  // 로그인 배경을 한 번도 쓰지 않은 봇이면 담지 않는다(풀어 덮어쓸 봇의 배경을 빈 기록으로 지우지 않게)
  const state = readIndex(backgroundDir);
  const background = fs.existsSync(path.join(backgroundDir, "index.json")) ? exportInputs({ state, folderOf: (id) => path.join(backgroundDir, id), prefix: "database/dashboard/" }) : [];
  const copy = await settingsCopy(settings);
  const inputs: ZipInput[] = [...(hasEnv ? [{ name: ".env", file: envFile }] : []), { name: "database/settings.restore.db", file: copy.file }, { name: "database/settings.restore.db.json", data: Buffer.from(JSON.stringify({ from: `전체 백업 ${name}` })) }, ...favicons.map((one) => ({ name: `database/dashboard/favicon/${one}`, file: path.join(faviconDir, one) })), ...background];

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, name);
  let part: string;
  try {
    part = await writeTo(out, inputs);
  } finally {
    copy.done();
  }
  const replaced = fs.readdirSync(outDir).filter((one) => /^musicbot-full-.*\.zip$/.test(one));
  for (const old of replaced) fs.rmSync(path.join(outDir, old), { force: true });
  fs.renameSync(part, out);
  ownerOnly(out);
  return { file: out, replaced, hasEnv, favicons: favicons.length, backgrounds: state.items.filter(isReady).length };
}

export { makeFullBackup };
