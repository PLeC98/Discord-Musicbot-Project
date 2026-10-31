// 재생 진행 막대. 재생 패널과 /nowplaying 이 같은 모양을 쓴다.

import { formatDuration } from "./format.ts";

const BAR_LENGTH = 16;

/** `1:30` ▬▬▬●▬▬ `3:20`. 길이를 모르면 핸들을 맨 앞에, 라이브는 끝이 없어 표식만 */
function progressBar(currentSec: number, totalSec: number, { live = false } = {}) {
  // 라이브에는 끝이 없어 위치도 길이도 찍지 않고, 경과 시간 자리에 표식을 둔다.
  // 접속해 있던 시간을 적으면 옆의 `-:--` 와 나란히 진행률처럼 읽힌다.
  if (live) {
    return `\`🔴LIVE\` ${"▬".repeat(BAR_LENGTH + 1)} \`-:--\``;
  }

  const currentStr = formatDuration(currentSec, "0:00");
  // 길이를 모르면(다운로드 전의 직접 링크 등) 곡이 없을 때처럼 비워 둔다. 0:00 은 길이가 0 인 곡으로 읽힌다
  const totalStr = formatDuration(totalSec, "--:--");
  if (!totalSec || totalSec === 0) {
    return `\`${currentStr}\` ●${"▬".repeat(BAR_LENGTH)} \`${totalStr}\``;
  }

  const progress = Math.min(currentSec / totalSec, 1);
  const filledCount = Math.round(progress * BAR_LENGTH);
  const bar = "▬".repeat(filledCount) + "●" + "▬".repeat(BAR_LENGTH - filledCount);
  return `\`${currentStr}\` ${bar} \`${totalStr}\``;
}

/** 곡이 없을 때의 막대 */
const emptyProgressBar = () => `\`--:--\` ●${"▬".repeat(BAR_LENGTH)} \`--:--\``;

export { progressBar, emptyProgressBar, BAR_LENGTH };
