// 재생 진행 막대. 재생 패널과 /nowplaying 이 같은 모양을 쓴다.

import format from "./format.ts";
const { formatDuration } = format;

const BAR_LENGTH = 16;

/** `1:30` ▬▬▬●▬▬ `3:20`. 길이를 모르면 손잡이를 맨 앞에, 라이브는 끝이 없어 표식만 */
function progressBar(currentSec: number, totalSec: number, { live = false } = {}) {
  // 라이브에는 끝이 없다. 어디쯤인지 찍을 지점도, 표시할 길이도 없다.
  // 경과 시간 자리는 비워 두는 대신 표식을 넣는다. 그 값은 곡 안의 위치가 아니라
  // "우리가 붙어 있은 시간"이라, 옆의 `--:--`과 나란히 두면 진행률처럼 읽힌다.
  if (live) {
    return `\`🔴LIVE\` ${"▬".repeat(BAR_LENGTH + 1)} \`-:--\``;
  }

  const currentStr = formatDuration(currentSec);
  const totalStr = formatDuration(totalSec);
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

const exported = { progressBar, emptyProgressBar, BAR_LENGTH };
export default exported;
export { exported as "module.exports" };
