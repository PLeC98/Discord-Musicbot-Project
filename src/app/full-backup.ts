// 전체 백업(봇 폴더의 명령 `pnpm run backup`). .env · 설정 DB · 파비콘을 ZIP 하나로 묶는다. 봇을 다른 폴더 · 다른 기기로 옮길 때,
// 받은 ZIP 을 (봇을 끈 채) 봇 폴더에 풀어 덮어쓰면 끝난다. 평문 .env 가 들어가니 대시보드에는 이 길이 없다(봇 폴더를 쓸 수 있는 사람만).
//
// 설정 DB 는 database/settings.db 가 아니라 database/settings.restore.db 로 담는다. 다음 기동이 지금 것을 스냅샷으로 남기고 바꿔 끼운다
// (store/snapshots). 풀어서 settings.db 를 덮으면 그 폴더에 남은 -wal 이 새 파일에 얹혀 깨질 수 있다.
// 만든 파일은 database/full-backups/ 에 하나만 둔다(평문 토큰이 든 파일이 쌓이지 않게).

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { zip } from "../infra/zip.ts";
import { ownerOnly } from "../infra/owner-only.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { isFaviconFile } from "../dashboard/appearance.ts";

type Paths = { envFile: string; databaseDir: string; faviconDir: string; outDir: string };
const REAL: Paths = { envFile: PROJECT.env, databaseDir: PROJECT.database, faviconDir: path.join(PROJECT.dashboardData, "favicon"), outDir: path.join(PROJECT.database, "full-backups") };

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: Date) => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;

// 켜져 있는 봇이 쓰는 중이어도 한 시점의 사본(SQLite 백업)
async function settingsCopy(file: string): Promise<Buffer> {
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-backup-")), "settings.db");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    await db.backup(temp);
    return fs.readFileSync(temp);
  } finally {
    db.close();
    fs.rmSync(path.dirname(temp), { recursive: true, force: true });
  }
}

/** 만든다. file: 만든 ZIP, replaced: 지운 이전 백업, hasEnv: .env 를 담았나 */
async function makeFullBackup(paths: Partial<Paths> = {}, at = new Date()) {
  const { envFile, databaseDir, faviconDir, outDir } = { ...REAL, ...paths };
  const settings = path.join(databaseDir, "settings.db");
  if (!fs.existsSync(settings)) throw Object.assign(new Error(`설정 DB 가 없습니다: ${settings}`), { code: "NO_SETTINGS_DB" });
  const name = `musicbot-full-${stamp(at)}.zip`;
  const hasEnv = fs.existsSync(envFile);
  const favicons = fs.existsSync(faviconDir) ? fs.readdirSync(faviconDir).filter(isFaviconFile) : [];
  const file = zip([...(hasEnv ? [{ name: ".env", data: fs.readFileSync(envFile) }] : []), { name: "database/settings.restore.db", data: await settingsCopy(settings) }, { name: "database/settings.restore.db.json", data: Buffer.from(JSON.stringify({ from: `전체 백업 ${name}` })) }, ...favicons.map((one) => ({ name: `database/dashboard/favicon/${one}`, data: fs.readFileSync(path.join(faviconDir, one)) }))]);

  fs.mkdirSync(outDir, { recursive: true });
  const replaced = fs.readdirSync(outDir).filter((one) => /^musicbot-full-.*\.zip$/.test(one));
  for (const old of replaced) fs.rmSync(path.join(outDir, old), { force: true });
  const out = path.join(outDir, name);
  fs.writeFileSync(out, file, { mode: 0o600 });
  ownerOnly(out);
  return { file: out, replaced, hasEnv, favicons: favicons.length };
}

export { makeFullBackup };
