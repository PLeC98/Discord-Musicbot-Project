// 응답 상태와 부른 순서를 흉내 내는 가짜 상호작용. src/ui/delivery 는 replied, deferred 로 분기하므로
// reply, deferReply, deferUpdate 가 그 값을 바꿔야 응답 분기 테스트가 헛되이 통과하지 않는다.
// 보낸 것은 flags 로 본인(self), 모두(all)를 구분해 calls 에 적는다

import { MessageFlags, type RepliableInteraction } from "discord.js";
import { fake } from "./fake.ts";

type Over = { replied?: boolean; deferred?: boolean; command?: boolean; component?: boolean; channel?: boolean; denied?: boolean };

function asked({ replied = false, deferred = false, command = true, component = false, channel = true, denied = false }: Over = {}) {
  const calls: string[] = [];
  // 보낸 첨부 이름(응답, 후속, 채널)
  const files: string[][] = [];
  const visible = (p: { flags?: unknown; files?: Array<{ name: string }> } = {}) => {
    if (p.files) files.push(p.files.map((file) => file.name));
    return [p.flags].flat().includes(MessageFlags.Ephemeral) ? "self" : "all";
  };
  const it = {
    replied,
    deferred,
    isChatInputCommand: () => command,
    isMessageComponent: () => component,
    reply: async (p: { flags?: unknown }) => {
      calls.push(`reply:${visible(p)}`);
      it.replied = true;
      return { resource: { message: { id: "R" } } };
    },
    deferReply: async (p?: { flags?: unknown }) => {
      calls.push(`deferReply:${visible(p)}`);
      it.deferred = true;
    },
    followUp: async (p: { flags?: unknown }) => (calls.push(`followUp:${visible(p)}`), { id: "F" }),
    editReply: async () => calls.push("editReply"),
    deferUpdate: async () => ((it.deferred = true), calls.push("deferUpdate")),
    deleteReply: async (id?: string) => calls.push(id ? `delete:${id}` : "delete"),
    channel: channel
      ? {
          send: async (p: { files?: Array<{ name: string }> }) => {
            calls.push(`send:${visible(p)}`.replace(":all", ""));
            if (denied) throw new Error("Missing Permissions");
            return { id: "C", delete: async () => calls.push("delete:C") };
          },
        }
      : null,
  };
  return { it, calls, files, real: fake<RepliableInteraction>(it) };
}

export { asked };
