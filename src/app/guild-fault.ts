// 서버 하나에서 모르는 오류가 났다(목록에 없는 오류). 그 서버의 플레이어 상태를 믿을 수 없으니 그 서버만 다시 시작한다:
// 세션 저장 → 채널에 남긴 채 버리기 → 저장된 세션으로 복원. 다른 서버는 아무 일 없다.
// 같은 서버에서 짧은 시간에 되풀이되면 세션이 까닭일 수 있으니 세션을 삭제하고 그 서버만 멈춘다.

import logger from "../infra/log/logger.ts";
import type { Player } from "../player/player.ts";

const log = logger.child({ category: "core" });

const WINDOW_MS = 10 * 60_000;
const MAX_RESETS = 3;

/** 다시 시작할 때 쓰는 것. players: 레지스트리 · restore: 그 서버의 저장된 세션을 복원한다 */
type Deps = {
  players: Pick<Map<string, Pick<Player, "dispose" | "currentTrack" | "queue">>, "get">;
  restore(guildId: string): Promise<unknown>;
  now?: () => number;
};

function createGuildFaults({ players, restore, now = () => Date.now() }: Deps) {
  const recent = new Map<string, number[]>();
  const resetting = new Set<string>();

  /** 서버 guildId 에서 모르는 오류가 났다. where: 어디서 새어 나왔나(로그) */
  return async function fault(guildId: string, error: unknown, where: string) {
    log.error(`서버 ${guildId} 에서 모르는 오류 (${where}):`, error);
    const player = players.get(guildId);
    // 복원할 플레이어가 없다(명령 · 화면 쪽 일). 로그만 남긴다. 다시 시작하는 중에 난 것은 그 다시 시작이 맡는다
    if (!player || resetting.has(guildId)) return;

    const at = now();
    const times = (recent.get(guildId) ?? []).filter((t) => at - t < WINDOW_MS);
    times.push(at);
    recent.set(guildId, times);
    if (times.length > MAX_RESETS) {
      log.error(`서버 ${guildId} 에서 모르는 오류가 되풀이되어(${WINDOW_MS / 60_000}분에 ${MAX_RESETS}번 넘게) 이 서버의 재생을 멈춥니다. 세션은 삭제합니다`);
      await player.dispose({ reason: "되풀이 오류로 멈춤", session: "remove", panel: "stop", end: "fault" });
      return;
    }

    // 지킬 곡이 없으면 다시 시작할 것도 없다. 평소처럼 버린다
    if (!player.currentTrack && player.queue.length === 0) {
      await player.dispose({ reason: "모르는 오류로 정리", session: "remove", end: "fault" });
      return;
    }
    resetting.add(guildId);
    try {
      log.warn(`서버 ${guildId} 만 다시 시작합니다(세션 저장 → 정리 → 복원)`);
      await player.dispose({ reason: "모르는 오류로 다시 시작", session: "save", stay: true, end: "fault" });
      await restore(guildId);
    } catch (e) {
      log.error(`서버 ${guildId} 다시 시작 실패:`, e);
    } finally {
      resetting.delete(guildId);
    }
  };
}

type GuildFault = ReturnType<typeof createGuildFaults>;

export { createGuildFaults, WINDOW_MS, MAX_RESETS };
export type { GuildFault };
