// 재생 진행 막대. 재생 패널과 /nowplaying 이 같은 모양을 쓴다.

import { LIVE_MARK, formatDuration } from "./format.ts";

const BAR_LENGTH = 16;

/** `1:30` ▬▬▬●▬▬ `3:20`. 길이를 모르면 핸들을 맨 앞에, 라이브는 끝이 없어 표식만 */
function progressBar(currentSec: number, totalSec: number, { live = false } = {}) {
  // 라이브에는 끝이 없어 위치도 길이도 찍지 않고, 경과 시간 자리에 표식을 둔다.
  // 접속해 있던 시간을 적으면 옆의 `-:--` 와 나란히 진행률처럼 읽힌다.
  if (live) {
    return `\`${LIVE_MARK}\` ${"▬".repeat(BAR_LENGTH + 1)} \`-:--\``;
  }

  // 길이를 모르면(다운로드 전의 직접 링크 등) 핸들을 맨 앞에 두고 길이는 비운다. 0:00 은 길이가 0 인 곡으로 읽힌다
  const known = Number.isFinite(totalSec) && totalSec > 0;
  const at = Number.isFinite(currentSec) && currentSec > 0 ? currentSec : 0;
  // 표시 길이는 실제 음원과 몇 초 다를 수 있다. 위치는 길이에서 멈춘다(대시보드와 같다)
  const shown = known ? Math.min(at, totalSec) : at;
  // 채운 칸은 내림이라 끝에 닿아야 다 찬다
  const filled = known ? Math.floor((shown / totalSec) * BAR_LENGTH) : 0;
  return `\`${formatDuration(shown, "0:00")}\` ${"▬".repeat(filled)}●${"▬".repeat(BAR_LENGTH - filled)} \`${formatDuration(totalSec, "--:--")}\``;
}

/** 곡이 없을 때의 막대 */
const emptyProgressBar = () => `\`--:--\` ●${"▬".repeat(BAR_LENGTH)} \`--:--\``;

export { progressBar, emptyProgressBar, BAR_LENGTH };
