// 받아 두는 외부 프로그램 폴더(vendor/ffmpeg, vendor/bgutil)의 프로세스 사이 잠금. 기록(state.json)을 고치는 곳은 모두 이 안에서 새로 읽고 고쳐 쓴다.
// 잠금은 인스턴스 잠금과 같은 방식(infra/instance-lock)을 그 폴더에 쓴다

import fs from "node:fs";
import { acquireInstanceLock } from "./instance-lock.ts";

/** 잠금을 기다리는 기본 상한(ms). 다른 프로세스가 받는 중이면 끝날 때까지 기다린다 */
const LOCK_WAIT_MS = 15 * 60_000;
const LOCK_POLL_MS = 500;

/** 폴더 잠금을 걸고 fn을 부른다. 다른 프로세스가 잠그고 있으면 상한까지 기다리고, 그래도 풀리지 않으면 { holder }를 반환한다 */
async function withLock<T>(dir: string, fn: () => Promise<T> | T, waitMs = LOCK_WAIT_MS): Promise<{ ok: true; value: T } | { ok: false; holder: number | null }> {
  fs.mkdirSync(dir, { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    const held = await acquireInstanceLock(dir);
    if (held.ok) {
      try {
        return { ok: true, value: await fn() };
      } finally {
        await held.release();
      }
    }
    if (Date.now() >= until) return { ok: false, holder: held.holder };
    await new Promise((done) => setTimeout(done, LOCK_POLL_MS));
  }
}

export { withLock };
