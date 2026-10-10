// 지금 어느 서버의 일인가(와 무슨 일인가). 서버 일의 입구(디스코드 이벤트 처리기 · 대시보드 서버 경로 · 라이브러리 리스너)가 문맥을 붙이면
// 그 뒤의 타이머 · 약속 · await 가 문맥을 잇는다. 새어 나온 오류를 그 서버로 돌릴 때(app/resilience),
// 띄운 자식 프로세스가 어느 서버의 무슨 일인지 적을 때(infra/process-registry) 읽는다.
// 이벤트 리스너는 건 쪽이 아니라 쏜 쪽의 문맥에서 불리므로 걸 때 묶는다(bindToGuild).

import { AsyncLocalStorage } from "node:async_hooks";
import type { Job } from "./process-job.ts";

const store = new AsyncLocalStorage<{ guildId: string; job: Job | null }>();

/** guildId 문맥에서 fn 을 부른다. job 을 주면 그 일로 적는다 */
function inGuild<T>(guildId: string, fn: () => T, job: Job | null = null): T {
  return store.run({ guildId, job }, fn);
}

/** 지금 문맥의 서버. 문맥 밖이면 null */
function currentGuild(): string | null {
  return store.getStore()?.guildId ?? null;
}

/** 지금 문맥의 일. 정하지 않았으면 null */
function currentJob(): Job | null {
  return store.getStore()?.job ?? null;
}

/** 리스너를 guildId 문맥에 묶는다. 누가 쏘든 그 서버의 일로 돈다 */
function bindToGuild<A extends unknown[], R>(guildId: string, fn: (...args: A) => R): (...args: A) => R {
  return store.run({ guildId, job: null }, () => AsyncLocalStorage.bind(fn));
}

export { inGuild, currentGuild, currentJob, bindToGuild };
