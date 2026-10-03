// 버튼 · 메뉴 · 모달 처리기 하나의 자리. 상호작용 종류와 custom_id 앞머리로 고른다(src/discord/events/interaction-create).

import type { ButtonInteraction, Interaction, ModalSubmitInteraction, RoleSelectMenuInteraction, StringSelectMenuInteraction } from "discord.js";

/** 종류마다 처리기가 받는 상호작용. 서버 안의 것만 온다 */
type ByKind = {
  button: ButtonInteraction<"cached">;
  select: StringSelectMenuInteraction<"cached">;
  roleSelect: RoleSelectMenuInteraction<"cached">;
  modal: ModalSubmitInteraction<"cached">;
};
type Kind = keyof ByKind;
/** enabled: 운영자 설정으로 기능을 껐으면 false. 꺼진 기능의 처리기는 없는 것과 같다(명령의 enabled 와 같은 뜻) */
type Route = { kind: Kind; prefix: string; enabled?: () => boolean; handle(interaction: ByKind[Kind]): unknown };

/** 처리기 하나. prefix 로 시작하는 custom_id 를 받는다 */
const route = <K extends Kind>(kind: K, prefix: string, handle: (interaction: ByKind[K]) => unknown, opts: { enabled?: () => boolean } = {}): Route => ({ kind, prefix, ...opts, handle: handle as Route["handle"] });

/** 서버 안의 버튼 · 메뉴 · 모달이면 그 종류와 좁힌 상호작용. 아니면 null */
function componentOf(interaction: Interaction): { kind: Kind; interaction: ByKind[Kind] } | null {
  if (!interaction.inCachedGuild()) return null;
  if (interaction.isButton()) return { kind: "button", interaction };
  if (interaction.isStringSelectMenu()) return { kind: "select", interaction };
  if (interaction.isRoleSelectMenu()) return { kind: "roleSelect", interaction };
  if (interaction.isModalSubmit()) return { kind: "modal", interaction };
  return null;
}

/** 맞는 처리기. 앞머리가 여럿 맞으면 가장 긴 것(더 좁은 것)이 받는다. 그 처리기가 꺼져 있으면 더 넓은 것으로 넘기지 않고 없음 */
function routeOf(routes: readonly Route[], kind: Kind, customId: string): Route | null {
  let best: Route | null = null;
  for (const r of routes) if (r.kind === kind && customId.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best && (best.enabled?.() ?? true) ? best : null;
}

export { route, componentOf, routeOf };
export type { Kind, Route, ByKind };
