import { SlashCommandBuilder } from "discord.js";
import { answerAutoplay } from "../interactions/autoplay.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

// 장르는 옵션으로 받지 않는다. 자동재생 버튼과 같은 선택 화면을 띄운다.
// 옵션으로 받으면 목록이 기동 시점에 굳어(choices) 장르를 고쳐도 재배포 전까지 반영되지 않는다.

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("autoplay").setDescription("Toggle autoplay. Pick a genre when turning it on.").setDescriptionLocalizations({ ko: "자동재생을 토글합니다" }),

  execute(interaction, client) {
    return answerAutoplay(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
