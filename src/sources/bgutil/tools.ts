// bgutil 설치에 필요한 것이 갖춰졌는지: git(저장소 체크아웃), npm(의존성 설치), vendor/bgutil에 쓸 수 있는지.
// 도구는 버전을 물어 PATH에서 찾는다(설치 스크립트가 쓰는 것과 같은 이름). Windows의 npm은 .cmd라 셸로 실행한다

import childProcess from "node:child_process";
import fs from "node:fs";
import { toolEnv } from "../../config/tool-env.ts";
import type { BgutilNeed } from "./status-types.ts";

/** 도구 하나를 실행해 본다(상한 10초). 실행되고 0으로 끝나면 true */
function runs(command: string, args: string[]): Promise<boolean> {
  return new Promise((done) => {
    const shell = process.platform === "win32" && command === "npm";
    childProcess.execFile(shell ? `${command} ${args.join(" ")}` : command, shell ? [] : args, { env: toolEnv(), timeout: 10_000, windowsHide: true, shell }, (error) => done(!error));
  });
}

/** 폴더를 만들고 쓸 수 있으면 true */
function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 없는 것 목록(다 있으면 빈 배열) */
async function missingNeeds(dir: string, run: (command: string, args: string[]) => Promise<boolean> = runs): Promise<BgutilNeed[]> {
  const [git, npm] = await Promise.all([run("git", ["--version"]), run("npm", ["--version"])]);
  return [...(git ? [] : (["git"] as const)), ...(npm ? [] : (["npm"] as const)), ...(writable(dir) ? [] : (["folder"] as const))];
}

export { missingNeeds };
