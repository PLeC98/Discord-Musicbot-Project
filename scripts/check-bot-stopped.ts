// pnpm install의 첫 단계(루트 preinstall). 이 폴더의 봇이 켜져 있으면 설치를 멈춘다.
// pnpm은 preinstall이 실패하면 node_modules와 잠금 파일을 건드리지 않고 끝난다. 켜진 봇이 쓰는 모듈(네이티브 포함)을 바꾸지 않게.
// 첫 설치에는 node_modules가 없으므로 Node 기본 모듈만 쓰는 파일만 불러온다

import "../src/infra/log/choose-at-start.ts"; // 다른 import보다 먼저 로그 언어를 고른다
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { scriptLine } from "../src/infra/script-line.ts";

const held = await acquireInstanceLock(PROJECT.database);
if (!held.ok) {
  scriptLine("install")("error", `봇이 실행 중이라(${held.holder ? `PID ${held.holder}` : "PID 모름"}) 설치 안 함. 봇을 끄고 다시 실행하세요`);
  process.exit(1);
}
await held.release();
