// 삭제하기 전에 "실행 중인 프로그램이 이 안에 있나"를 판단하고, 폴더 크기를 센다(vendor의 외부 프로그램 정리가 쓴다).
// 경로는 실제 경로로 풀어 비교한다(링크, 정션, 상대 경로). Windows는 path.relative가 대소문자를 가리지 않는다

import fs from "node:fs";
import path from "node:path";

/** 실제 경로. 없거나 풀 수 없으면 절대 경로로만 */
function real(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** child가 parent와 같거나 그 안에 있다 */
function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * 삭제하면 안 되는 대상인지 판단하는 함수를 만든다. 대상(폴더나 파일)이 다음이면 true:
 * file(쓰는 실행 파일. 경로가 아닌 이름만이면 PATH가 정한다)을 담고 있다, PATH의 폴더를 담고 있다, PATH의 폴더 바로 안에 있다(PATH가 찾는 실행 파일일 수 있다)
 * @param pathEnv  PATH 값(기본은 이 프로세스의 PATH)
 */
function pathHolder(file: string | null, pathEnv = process.env.PATH ?? ""): (target: string) => boolean {
  const used = file && (path.isAbsolute(file) || /[\\/]/.test(file)) ? real(file) : null;
  const dirs = pathEnv
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean)
    .map(real);
  return (target) => {
    const t = real(target);
    if (used && inside(t, used)) return true;
    return dirs.some((d) => inside(t, d) || path.relative(path.dirname(t), d) === "");
  };
}

/** 폴더(또는 파일)의 크기 합. 링크는 따라가지 않고, 읽지 못한 것은 0으로 센다 */
async function treeSize(target: string): Promise<number> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.isFile() ? stat.size : 0;
  let total = 0;
  let entries: string[];
  try {
    entries = await fs.promises.readdir(target);
  } catch {
    return 0;
  }
  for (const name of entries) total += await treeSize(path.join(target, name));
  return total;
}

export { pathHolder, treeSize };
