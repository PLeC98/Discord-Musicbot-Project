// 지금 어느 서버의 일인가. 서버 일의 입구(디스코드 이벤트 처리기 · 라이브러리 리스너)가 문맥을 붙이면
// 그 뒤의 타이머 · 약속 · await 가 문맥을 잇는다. 새어 나온 오류를 그 서버로 돌릴 때 읽는다(app/resilience).
// 이벤트 리스너는 건 쪽이 아니라 쏜 쪽의 문맥에서 불리므로 걸 때 묶는다(bindToGuild).

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** guildId 문맥에서 fn 을 부른다 */
function inGuild<T>(guildId: string, fn: () => T): T {
  return store.run(guildId, fn);
}

/** 지금 문맥의 서버. 문맥 밖이면 null */
function currentGuild(): string | null {
  return store.getStore() ?? null;
}

/** 리스너를 guildId 문맥에 묶는다. 누가 쏘든 그 서버의 일로 돈다 */
function bindToGuild<A extends unknown[], R>(guildId: string, fn: (...args: A) => R): (...args: A) => R {
  return store.run(guildId, () => AsyncLocalStorage.bind(fn));
}

export { inGuild, currentGuild, bindToGuild };
