// 돌고 있는 봇의 버전: package.json 의 version 과, git 체크아웃이면 지금 커밋(짧은 해시).
// git 을 실행하지 않고 .git 의 파일을 읽는다(git 이 없는 곳에서도 같다). 기동 때 한 번 읽는다

import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "./project-paths.ts";
import logger from "./log/logger.ts";
import { codeOf, messageOf } from "./error-text.ts";
const log = logger.child({ category: "core" });

// 없거나 폴더면(.git 은 보통 폴더다) 조용히 null
const read = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (error) {
    const code = codeOf(error);
    if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR") log.debug(`버전 정보 읽기 실패(${file}): ${messageOf(error)}`);
    return null;
  }
};

/** .git 폴더. 워크트리 · 서브모듈이면 .git 은 "gitdir: …" 를 적은 파일이다 */
function gitDir(): string | null {
  const dotGit = path.join(PROJECT.root, ".git");
  const pointer = /^gitdir: (.+)$/m.exec(read(dotGit) ?? "")?.[1];
  if (pointer) return path.resolve(PROJECT.root, pointer);
  return fs.existsSync(path.join(dotGit, "HEAD")) ? dotGit : null;
}

/** HEAD 가 가리키는 커밋. 브랜치 이름이면 개별 ref 파일, 없으면 packed-refs 에서(워크트리는 공용 폴더까지) */
function headCommit(): string | null {
  const dir = gitDir();
  if (!dir) return null;
  const head = read(path.join(dir, "HEAD"));
  const ref = /^ref: (.+)$/.exec(head ?? "")?.[1];
  if (!ref) return head && /^[0-9a-f]{40}$/.test(head) ? head : null;
  const common = read(path.join(dir, "commondir"));
  for (const base of [dir, ...(common ? [path.resolve(dir, common)] : [])]) {
    const loose = read(path.join(base, ref));
    if (loose) return loose;
    const packed = (read(path.join(base, "packed-refs")) ?? "").split("\n").find((line) => line.endsWith(` ${ref}`));
    if (packed) return packed.slice(0, 40);
  }
  return null;
}

function readVersion() {
  const pkg = JSON.parse(read(path.join(PROJECT.root, "package.json")) ?? "{}") as { version?: string };
  const commit = headCommit();
  return `${pkg.version ?? "?"}${commit ? ` (${commit.slice(0, 7)})` : ""}`;
}

/** 예: "1.0.0 (9880722)". git 체크아웃이 아니면 버전만 */
const BOT_VERSION = readVersion();

export { BOT_VERSION };
