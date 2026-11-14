// 지금 어느 서버의 작업인가(와 무슨 작업인가). 서버 작업의 진입점(디스코드 이벤트 핸들러, 대시보드 서버 경로, 라이브러리 리스너)이 문맥을 붙이면
// 그 뒤의 타이머, Promise, await 가 문맥을 잇는다. 새어 나온 오류를 그 서버로 돌릴 때(app/resilience),
// 실행한 자식 프로세스가 어느 서버의 무슨 일인지 적을 때(infra/process-registry) 읽는다.
// 곡을 넣는 작업은 봇이 붙을 음성 채널도 싣는다(inVoiceTarget). 봇이 아직 음성 밖일 때 연령 제한 판정(sources/age-gate)이 그 채널을 본다.
// 이벤트 리스너는 건 쪽이 아니라 쏜 쪽의 문맥에서 불리므로 걸 때 묶는다(bindToGuild).

import { AsyncLocalStorage } from "node:async_hooks";
import type { Job } from "./process-job.ts";

const store = new AsyncLocalStorage<{ guildId: string; job: Job | null; voiceTarget?: string | null }>();

/** guildId 문맥에서 fn 을 부른다. job 을 주면 그 작업으로 적는다 */
function inGuild<T>(guildId: string, fn: () => T, job: Job | null = null): T {
  return store.run({ guildId, job }, fn);
}

/**
 * 서버 문맥 밖에서 fn 을 부른다. 서버와 상관없는 봇 작업(여러 서버가 함께 쓰는 큐)을 서버 작업 안에서 시작할 때 쓴다.
 * 그 안에서 건 타이머, 실행한 프로세스, 잡히지 않은 오류는 부른 서버의 것이 되지 않는다
 */
function outsideGuild<T>(fn: () => T): T {
  return store.exit(fn);
}

/** 지금 문맥의 서버. 문맥 밖이면 null */
function currentGuild(): string | null {
  return store.getStore()?.guildId ?? null;
}

/** 지금 문맥(서버, 작업)을 그대로 두고 봇이 붙을 음성 채널을 실어 fn 을 부른다. 서버 문맥 밖이면 그냥 부른다 */
function inVoiceTarget<T>(channelId: string | null, fn: () => T): T {
  const now = store.getStore();
  return now ? store.run({ ...now, voiceTarget: channelId }, fn) : fn();
}

/** 지금 문맥에 실린, 봇이 붙을 음성 채널. 없으면 null */
function currentVoiceTarget(): string | null {
  return store.getStore()?.voiceTarget ?? null;
}

/** 지금 문맥의 작업. 정하지 않았으면 null */
function currentJob(): Job | null {
  return store.getStore()?.job ?? null;
}

/**
 * 리스너를 guildId 문맥에 묶는다. 누가 쏘든 그 서버의 작업으로 돈다.
 * 리스너가 동기로 던지면 쏜 쪽으로 넘기지 않고 그 서버 문맥에서 따로 던진다(app/resilience 가 그 서버의 오류로 받는다).
 * @discordjs/voice 는 모든 플레이어의 프레임을 타이머 하나로 돌리며 그 안에서 상태 이벤트를 쏜다. 거기로 던지면 루프가 끊겨 모든 서버의 소리가 멈추고, 오류는 루프를 시작한 서버의 것으로 보인다
 */
function bindToGuild<A extends unknown[]>(guildId: string, fn: (...args: A) => void): (...args: A) => void {
  const guarded = (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      process.nextTick(() => {
        throw error;
      });
    }
  };
  return store.run({ guildId, job: null }, () => AsyncLocalStorage.bind(guarded));
}

export { inGuild, outsideGuild, currentGuild, currentJob, bindToGuild, inVoiceTarget, currentVoiceTarget };
