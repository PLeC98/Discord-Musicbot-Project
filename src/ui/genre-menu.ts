// 자동재생 장르 선택 화면. 자동재생 버튼과 `/autoplay`가 같은 것을 띄운다.
// 진입점마다 따로 만들면 한쪽만 고쳐져 갈라진다(실제로 명령 쪽은 영문 키 목록을 쓰고 있었다).

import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import * as genreConfig from "../config/genres.ts";
import { AUTOPLAY, customId } from "./custom-ids.ts";
import { frame, reply } from "./frame.ts";
import * as autoplayText from "./text/ko/autoplay.ts";

/**
 * 본인에게만 보이는 장르 선택 메시지. 그대로 reply에 넘긴다.
 * 고른 결과는 src/discord/interactions/modal-handler.ts 의 장르 처리가 받는다. 지금 플레이어(없으면 새로 만든 것)에 걸므로 세션을 싣지 않는다.
 */
function genreSelect(placeholder: string) {
  // 장르 정의는 config/genres.yaml 한 곳에서 관리. 부를 때마다 읽는다(파일이 바뀌면 곧바로 반영)
  const { genres } = genreConfig.genres();

  return (
    new StringSelectMenuBuilder()
      .setCustomId(customId(AUTOPLAY, "genre"))
      .setPlaceholder(placeholder)
      // 키가 곧 이름이다. 따로 표시용 이름을 두지 않는다. 이모지는 비워 둘 수 있다
      .addOptions(
        Object.entries(genres).map(([name, g]) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(name).setValue(name);
          return g.emoji ? option.setEmoji(g.emoji) : option;
        }),
      )
  );
}

// 장르 메뉴가 달린 화면. 본인에게만 보인다
function withMenu(t: { title: string; description: string; placeholder: string }) {
  const container = frame({ title: t.title, body: t.description });
  container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(genreSelect(t.placeholder)));
  return reply(container);
}

/** 켤 때. 장르를 고르면 그 장르로 켜진다 */
const buildGenreMenu = () => withMenu(autoplayText.pickGenre());

/**
 * 끌 때. 이미 꺼진 상태를 알리면서, 메뉴가 떠 있는 동안 장르를 다시 고를 기회를 준다.
 * 고르면 그 장르로 다시 켜지고(장르 변경), 그냥 두거나 닫으면 꺼진 채로 끝난다.
 */
const buildAutoplayOffMenu = () => withMenu(autoplayText.turnedOff());

/** 장르를 골라 켰다(모두에게 보내는 결과). by 는 고른 사람 */
function autoplayOn(genre: string, by: { toString(): string }) {
  const t = autoplayText.turnedOn(genre);
  return frame({ title: t.title, body: t.description, footer: [`${t.by} ${by}`], divider: true });
}

export { buildGenreMenu, buildAutoplayOffMenu, autoplayOn };
