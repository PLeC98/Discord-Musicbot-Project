// 가짜 상호작용의 종류 메서드. 상호작용 입구(src/discord/events/interaction-create)가 이것들로 종류를 가른다.
// 가짜를 만들 때 먼저 펼치고, 시험이 정할 것은 뒤에서 덮는다

type Kind = "button" | "select" | "roleSelect" | "modal" | "command";

const interactionKind = (kind: Kind) => ({
  isChatInputCommand: () => kind === "command",
  isButton: () => kind === "button",
  isStringSelectMenu: () => kind === "select",
  isRoleSelectMenu: () => kind === "roleSelect",
  isModalSubmit: () => kind === "modal",
  isMessageComponent: () => kind === "button" || kind === "select" || kind === "roleSelect",
  inCachedGuild: () => true,
});

export { interactionKind };
export type { Kind as InteractionKind };
