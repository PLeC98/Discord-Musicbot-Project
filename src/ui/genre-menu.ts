// 자동재생 장르 선택 화면. 자동재생 버튼과 `/autoplay`가 같은 것을 표시한다.
// 진입점마다 따로 만들면 한쪽만 고쳐져 어긋난다(실제로 명령 쪽은 영문 키 목록을 쓰고 있었다).

import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import * as genreConfig from "../config/genres.ts";
import { AUTOPLAY, customId } from "./custom-ids.ts";
import { frame, reply } from "./frame.ts";
import type { IconKey } from "./icons.ts";
import * as autoplayText from "./text/ko/autoplay.ts";

/**
 * 본인에게만 보이는 장르 선택 메시지. 그대로 reply에 넘긴다.
 * 선택한 결과는 src/discord/interactions/modal-handler.ts 의 장르 처리가 받는다. 지금 플레이어(없으면 새로 만든 것)에 걸므로 세션을 싣지 않는다.
 */
function genreSelect(placeholder: string) {
  // 장르 정의는 장르 설정 한 곳에서 관리. 부를 때마다 읽는다(대시보드에서 저장하면 곧바로 반영)
  const { genres } = genreConfig.genres();

  return (
    new StringSelectMenuBuilder()
      .setCustomId(customId(AUTOPLAY, "genre"))
      .setPlaceholder(placeholder)
      // 보이는 것은 라벨, 선택한 값은 식별자(라벨을 바꿔도 열려 있던 메뉴가 깨지지 않는다). 이모지는 비워 둘 수 있다
      .addOptions(
        Object.entries(genres).map(([id, g]) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(g.label?.trim() || id).setValue(id);
          return g.emoji ? option.setEmoji(g.emoji) : option;
        }),
      )
  );
}

// 장르 메뉴가 달린 화면. 본인에게만 보인다
function withMenu(t: { icon: IconKey; title: string; description: string; placeholder: string }) {
  const container = frame({ icon: t.icon, title: t.title, body: t.description });
  container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(genreSelect(t.placeholder)));
  return reply(container);
}

/** 켤 때. 장르를 선택하면 그 장르로 켜진다 */
const buildGenreMenu = () => withMenu(autoplayText.pickGenre());

/**
 * 끌 때. 이미 꺼진 상태를 알리면서, 메뉴가 열려 있는 동안 장르를 다시 선택할 기회를 준다.
 * 선택하면 그 장르로 다시 켜지고(장르 변경), 그냥 두거나 닫으면 꺼진 채로 끝난다.
 */
const buildAutoplayOffMenu = () => withMenu(autoplayText.turnedOff());

/** 장르를 선택해 켰다(모두에게 보내는 결과). genre 는 식별자, 보이는 것은 라벨. by 는 선택한 사람 */
function autoplayOn(genre: string, by: { toString(): string }) {
  const t = autoplayText.turnedOn(genreConfig.labelOf(genre));
  return frame({ icon: t.icon, title: t.title, body: t.description, footer: [`${t.by} ${String(by)}`], divider: true });
}

export { buildGenreMenu, buildAutoplayOffMenu, autoplayOn };
