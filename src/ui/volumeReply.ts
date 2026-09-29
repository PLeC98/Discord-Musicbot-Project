// 음량을 바꾼 결과. 명령(/volume)과 패널 버튼의 입력 창이 같은 화면을 쓴다.

import { EmbedBuilder } from "discord.js";
import { colorOf } from "./colors.ts";
import * as controlText from "./text/controls.ts";

/** before · level 은 0~100. by 는 바꾼 사람(멘션으로 보인다) */
function volumeChanged({ before, level, by }: { before: number; level: number; by: { toString(): string } }) {
  const t = controlText.volumeSet(before, level);
  return new EmbedBuilder()
    .setTitle(t.title)
    .setDescription(t.description)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: t.by, value: `${by}`, inline: true });
}

export { volumeChanged };
