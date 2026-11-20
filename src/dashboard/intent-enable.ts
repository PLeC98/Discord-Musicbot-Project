// 운영자 패널의 특권 인텐트 켜기: 서버 100개 미만일 때 쓰는 포털 스위치(_LIMITED)를 PATCH /applications/@me로 켠다(디스코드 문서: _LIMITED만 API로 바꿀 수 있다).
// 운영자의 디스코드 앱 설정을 바꾸는 일이라 운영자가 직접 눌렀을 때만 한다. 켜기만 하고, 보낼 값은 여기서 계산한다(요청에는 어느 인텐트인지만 담긴다).
// 켜도 이 프로세스의 인텐트는 그대로다. 다시 시작해야 적용된다(infra/gateway-intents)

import { Routes } from "discord.js";
import { FLAGS, needsApproval, switchesOf, type AppFlags, type Privileged } from "../infra/gateway-intents.ts";

/** API로 바꿀 수 있는 비트(_LIMITED 셋, 프레즌스 포함) */
const LIMITED_BITS = [1 << 13, FLAGS.guildMembers.limited, FLAGS.messageContent.limited];

type AppRest = { get(route: `/${string}`): Promise<unknown>; patch(route: `/${string}`, options: { body: unknown }): Promise<unknown> };
/** enabled: 켰다, already: 이미 켜져 있다, approval: 서버가 100개 이상이라 스위치가 아니라 승인이 필요하다, unknown: 앱 설정에 플래그(flags)가 없다 */
type EnableResult = "enabled" | "already" | "approval" | "unknown";

// 비트 연산은 32비트로 잘리므로 셈으로 본다(flags가 2^31 이상이어도 맞게)
const has = (flags: number, bit: number) => Math.floor(flags / bit) % 2 === 1;
const withBit = (flags: number, bit: number) => (has(flags, bit) ? flags : flags + bit);

/** 인텐트를 켤 때 보낼 flags 후보. 앞의 값이 거절되면 뒤의 값을 보낸다: 현재 flags 전체에 켤 비트를 더한 값, 바꿀 수 있는 비트만 남기고 켤 비트를 더한 값 */
function flagsToEnable(current: number, name: Privileged): number[] {
  const bit = FLAGS[name].limited;
  const limitedOnly = LIMITED_BITS.filter((one) => has(current, one)).reduce((sum, one) => sum + one, 0);
  return [withBit(current, bit), withBit(limitedOnly, bit)];
}

// 디스코드가 이 값을 받지 않았다(400). 다른 값으로 보내 볼 수 있다. 401, 403, 429는 값을 바꿔도 같다
const rejectedValue = (error: unknown) => (error as { status?: unknown } | null)?.status === 400;

// 앞의 켜기가 끝나기를 기다린다. 읽고 고쳐 쓰기가 겹치면 뒤의 PATCH가 앞에서 켠 비트를 지울 수 있다
let queue: Promise<unknown> = Promise.resolve();

/**
 * 앱 설정을 읽고, 꺼져 있으면 그 스위치를 켠다. 디스코드가 둘 다 받지 않거나 다른 이유로 실패하면 예외를 던진다.
 * go: 읽은 뒤 바꾸기 직전에 부른다(요청한 세션이 끝났으면 예외를 던져 바꾸지 않는다)
 */
function enableIntent(rest: AppRest, name: Privileged, go?: () => void): Promise<EnableResult> {
  const run = queue.then(async (): Promise<EnableResult> => {
    const app = (await rest.get(Routes.currentApplication())) as AppFlags;
    if (needsApproval(app)) return "approval";
    const switches = switchesOf(app);
    if (!switches || typeof app.flags !== "number") return "unknown";
    if (switches[name]) return "already";
    const [all, limitedOnly] = flagsToEnable(app.flags, name);
    go?.();
    try {
      await rest.patch(Routes.currentApplication(), { body: { flags: all } });
    } catch (error) {
      if (!rejectedValue(error)) throw error;
      await rest.patch(Routes.currentApplication(), { body: { flags: limitedOnly } });
    }
    return "enabled";
  });
  queue = run.catch(() => undefined);
  return run;
}

export { enableIntent, flagsToEnable, LIMITED_BITS };
export type { EnableResult, AppRest };
