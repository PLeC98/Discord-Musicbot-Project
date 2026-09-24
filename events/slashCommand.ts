// 슬래시 명령 실행. 명령을 찾아 부르고, 실패하면 본인에게만 보이게 알린다.
// 본인에게만 보이는 응답의 수명은 이벤트를 거는 조립(index.ts)이 상호작용 처리기마다 건다.

import { Events } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "core" });
import { isDeadInteraction } from "../src/rules/deadInteraction.ts";
import { messageOf } from "../src/rules/errorKind.ts";
import type { ClientEvent } from "../src/app/main.ts";
const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const client = interaction.client;
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      log.error(`등록되지 않은 명령어: ${interaction.commandName}`);
      return;
    }

    try {
      // 서버 명령은 서버 안에서만. DM 에서도 쓰는 명령은 그대로 부른다
      if (command.anywhere) await command.execute(interaction, client);
      else if (interaction.inCachedGuild()) await command.execute(interaction, client);
      else await interaction.reply({ content: "❌ 서버에서만 쓸 수 있는 명령이에요.", flags: [1 << 6] });
    } catch (error) {
      log.error(`${interaction.commandName} 명령어 실행 중 오류:`, error);

      // 토큰이 죽었으면(10062/40060) 안내 시도가 곧 두 번째 같은 오류다. 아무 데도 닿지 않는다.
      if (isDeadInteraction(error)) return;

      const payload = { content: "❌ 명령어 실행 중 오류가 발생했습니다!", flags: [1 << 6] };
      const sending = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
      // 안내 실패는 여기서 끝낸다. 리스너 밖으로 던지면 client "error"를 거쳐 uncaughtException이 된다.
      await sending.catch((err) => log.error("오류 안내 전송 실패:", messageOf(err)));
    }
  },
};
export default exported;
