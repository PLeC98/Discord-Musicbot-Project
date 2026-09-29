// 음량을 바꾼 결과. 명령(/volume)과 패널 버튼의 입력 창이 같은 화면을 쓴다.

import { EmbedBuilder } from "discord.js";
import { colorOf } from "./colors.ts";

/** before · level 은 0~100. by 는 바꾼 사람(멘션으로 보인다) */
function volumeChanged({ before, level, by }: { before: number; level: number; by: { toString(): string } }) {
  return new EmbedBuilder()
    .setTitle("🔊 볼륨이 변경되었습니다")
    .setDescription(before === level ? `볼륨은 그대로 **${level}%**입니다.` : `**${before}%** → **${level}%**`)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: "👤 변경한 사람", value: `${by}`, inline: true });
}

export { volumeChanged };
