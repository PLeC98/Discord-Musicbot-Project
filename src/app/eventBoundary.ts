// 디스코드 이벤트 처리기의 경계. 인자에서 서버를 찾아 그 문맥에서 부르고(infra/guildContext),
// 새어 나온 던짐 · 거부를 받는 곳(onFault)에 넘긴다. 처리기는 모두 여기로 걸린다(app/main).

import { inGuild } from "../infra/guildContext.ts";

/** 새어 나온 오류를 받는 곳. guildId: 그 서버(모르면 null) · where: 어느 처리기 */
type OnFault = (error: unknown, guildId: string | null, where: string) => unknown;

// 이벤트 인자 중 서버를 가진 것(상호작용 · 메시지 · 음성 상태 등)
function guildOf(args: unknown[]): string | null {
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;
    if ("guildId" in arg && typeof arg.guildId === "string") return arg.guildId;
    if ("guild" in arg && arg.guild && typeof arg.guild === "object" && "id" in arg.guild && typeof arg.guild.id === "string") return arg.guild.id;
  }
  return null;
}

/** 처리기를 경계로 감싼다. 돌려주는 함수는 약속을 돌려주지 않는다(실패는 onFault 가 받는다) */
function guarded<A extends unknown[]>(where: string, listener: (...args: A) => unknown, onFault: OnFault) {
  return (...args: A) => {
    const guildId = guildOf(args);
    const run = () => {
      try {
        Promise.resolve(listener(...args)).catch((error: unknown) => onFault(error, guildId, where));
      } catch (error) {
        onFault(error, guildId, where);
      }
    };
    if (guildId) inGuild(guildId, run);
    else run();
  };
}

export { guarded, guildOf };
export type { OnFault };
