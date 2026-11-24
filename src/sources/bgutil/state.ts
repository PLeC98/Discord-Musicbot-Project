// vendor/bgutil의 기록(state.json): 지금 쓰는 빌드와 이전 빌드. 빌드 하나는 vendor/bgutil/<태그>-<받은 시각>/ 폴더(저장소 체크아웃, server/node_modules, server/build)다.
// 설치(sources/bgutil/install)가 쓰고, 봇은 기동 시 한 번 읽는다(sources/bgutil/bundle). 고치는 곳은 모두 폴더 잠금(infra/folder-lock) 안에서 새로 읽고 고쳐 쓴다

import fs from "node:fs";
import path from "node:path";
import { isCommitSha, isPlainTag } from "../../rules/bgutil-install.ts";
import type { LogText } from "../../infra/log/log-text.ts";
import { L } from "../../infra/log/text.ts";

/** 받아 둔 빌드 하나. folder: vendor/bgutil 안의 폴더 이름, tag: 저장소 태그, commit: 그 태그가 가리킨 커밋, version: server/package.json의 버전 */
type BgutilBuild = { folder: string; tag: string; commit: string; version: string };
/** active: 쓰는 빌드, previous: 이전 빌드 */
type BgutilState = { active: BgutilBuild | null; previous: BgutilBuild | null };
/** none: 기록이 없다(받은 적 없음), broken: 읽지 못했다(error는 원인) */
type ReadState = { kind: "ok"; state: BgutilState } | { kind: "none" } | { kind: "broken"; error: string | LogText };

const STATE_FILE = "state.json";
const EMPTY: BgutilState = { active: null, previous: null };
/** 버전 폴더 이름: <태그>-<받은 시각(ms)>. 점으로 시작하지 않아 임시 폴더, 휴지통과 겹치지 않는다 */
const VERSION_FOLDER = /^[0-9A-Za-z][0-9A-Za-z._-]*-\d{10,}$/;

const isBuild = (value: unknown): value is BgutilBuild => {
  const b = value as Partial<BgutilBuild> | null;
  return !!b && typeof b.folder === "string" && VERSION_FOLDER.test(b.folder) && typeof b.tag === "string" && isPlainTag(b.tag) && typeof b.commit === "string" && isCommitSha(b.commit) && typeof b.version === "string";
};

/** 기록을 읽는다. 형식이 올바르지 않으면 broken(폴더 이름이 vendor/bgutil 밖을 가리키는 경우 포함) */
function readState(dir: string): ReadState {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, STATE_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "broken", error: String((error as Error).message) };
  }
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof BgutilState, unknown>>;
    const active = data.active ?? null;
    const previous = data.previous ?? null;
    if ((active !== null && !isBuild(active)) || (previous !== null && !isBuild(previous))) return { kind: "broken", error: L.bgutil.stateBuildInvalid() };
    return { kind: "ok", state: { active, previous } };
  } catch (error) {
    return { kind: "broken", error: String((error as Error).message) };
  }
}

/** 기록을 쓴다. 쓰다 만 파일이 남지 않게 임시 파일에 먼저 쓰고 바꿔 넣는다 */
function writeState(dir: string, state: BgutilState) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, STATE_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}

/** 깨진 기록을 다른 이름으로 옮겨 둔다(직접 열어 볼 수 있게 삭제하지 않는다). 옮긴 경로를 반환한다 */
function setAsideBroken(dir: string, now: number): string {
  const aside = path.join(dir, `${STATE_FILE}.broken-${now}`);
  fs.renameSync(path.join(dir, STATE_FILE), aside);
  return aside;
}

export { readState, writeState, setAsideBroken, VERSION_FOLDER, EMPTY as EMPTY_STATE, STATE_FILE };
export type { BgutilBuild, BgutilState, ReadState };
