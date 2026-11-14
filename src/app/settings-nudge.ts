// 서버 설정이 바뀌면(디스코드 명령, 대시보드, 초기화) 그 서버를 보는 대시보드 화면에 다시 읽으라고 알린다.
// 볼륨만 바뀐 것은 알리지 않는다(설정 화면에 없고, 볼륨을 바꿀 때마다 저장된다).

import type { GuildField } from "../store/guild-settings.ts";

type Listen = (fn: (guildId: string, fields: GuildField[]) => void) => () => void;

/** onChanged 에 리스너를 붙이고, 떼는 함수를 돌려준다 */
function nudgeOnSettingsChange(onChanged: Listen, touched: (guildId: string) => void): () => void {
  return onChanged((guildId, fields) => {
    if (fields.some((field) => field !== "volume")) touched(guildId);
  });
}

export { nudgeOnSettingsChange };
