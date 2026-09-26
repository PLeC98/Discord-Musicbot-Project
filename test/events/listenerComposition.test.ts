// 상호작용 리스너 조합. 봇은 상호작용마다 리스너 여섯을 모두 깨우고 저마다 제 몫을 거른다.
// 처리기를 하나씩 시험하면 두 리스너가 같은 상호작용에 함께 답하는 것(늦은 쪽은 40060)도, 아무도 답하지 않는 것도 못 본다.
// 봇이 만드는 모든 custom_id · 모달 · 선택 메뉴를 여섯에 태워 정확히 하나만 답하는지 본다.

import fs from "node:fs";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Collection, type Interaction } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/tempStore.ts";
import { useExampleConfig } from "../helpers/exampleConfig.ts";
import buttonHandler from "../../events/buttonHandler.ts";
import djRoleConfigHandler from "../../events/djRoleConfigHandler.ts";
import modalHandler from "../../events/modalHandler.ts";
import playlistMoreHandler from "../../events/playlistMoreHandler.ts";
import slashCommand from "../../events/slashCommand.ts";
import sponsorConfigHandler from "../../events/sponsorConfigHandler.ts";

useExampleConfig();
const store = openTempStore("listeners-");
after(() => store.close());

const ROOT = path.join(import.meta.dirname, "..", "..");
const LISTENERS = { buttonHandler, djRoleConfigHandler, modalHandler, playlistMoreHandler, slashCommand, sponsorConfigHandler };

type Kind = "button" | "select" | "roleSelect" | "modal" | "command";
const RESPONSES = ["reply", "deferReply", "deferUpdate", "update", "showModal", "followUp", "editReply"] as const;

// 상호작용 하나. 답한 방법을 적는다. 권한이 없는 평범한 사용자이고, 봇은 쉬고 있다(플레이어 없음)
function interaction(kind: Kind, customId: string, answered: string[]) {
  const guild = { id: "g1", name: "서버", memberCount: 1, members: { me: { id: "bot", voice: { channel: null } }, cache: new Map() }, channels: { cache: new Map() }, roles: { cache: new Map() } };
  const it: Record<string, unknown> = {
    type: kind,
    customId,
    commandName: customId,
    guildId: "g1",
    guild,
    user: { id: "u1", username: "u1", bot: false },
    member: { id: "u1", guild, user: { id: "u1" }, voice: { channel: null }, roles: { cache: new Map() }, permissions: { has: () => false } },
    memberPermissions: { has: () => false },
    channel: { id: "c1", send: async () => ({ id: "sent" }) },
    channelId: "c1",
    message: { id: "m1", components: [], embeds: [], createdTimestamp: Date.now() },
    values: [],
    fields: { getTextInputValue: () => "50" },
    replied: false,
    deferred: false,
    client: { user: { id: "bot", tag: "bot#0", username: "bot", displayAvatarURL: () => "https://example.invalid/a.png" }, guilds: { cache: new Collection([["g1", guild]]) }, players: new Map(), commands: new Map([["probe", { data: { name: "probe" }, execute: (i: { reply(p: object): unknown }) => i.reply({ content: "ok" }) }]]) },
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isRoleSelectMenu: () => kind === "roleSelect",
    isModalSubmit: () => kind === "modal",
    isChatInputCommand: () => kind === "command",
    isRepliable: () => true,
    isFromMessage: () => true,
    inCachedGuild: () => true,
    inGuild: () => true,
  };
  for (const name of RESPONSES) {
    it[name] = async () => {
      answered.push(name);
      if (name === "deferReply" || name === "deferUpdate") it.deferred = true;
      else it.replied = true;
      return { id: "reply", createdTimestamp: Date.now(), delete: async () => {}, edit: async () => {} };
    };
  }
  return fake<Interaction>(it);
}

// 리스너마다 새 상호작용으로 돌려 누가 답했는지 가른다
async function answerers(kind: Kind, customId: string) {
  const who: string[] = [];
  const threw: string[] = [];
  for (const [name, listener] of Object.entries(LISTENERS)) {
    const answered: string[] = [];
    try {
      await (listener.execute as (it: Interaction) => unknown)(interaction(kind, customId, answered));
    } catch (error) {
      threw.push(`${name}: ${(error as Error).message}`);
    }
    if (answered.length) who.push(name);
  }
  return { who, threw };
}

const PANEL = ["music_pause", "music_skip", "music_previous", "music_stop", "music_shuffle", "music_queue", "music_loop", "music_highlight", "music_volume", "music_autoplay"].map((n) => `${n}:u1:s1`);
const CASES: [Kind, string, string][] = [
  ...PANEL.map((id): [Kind, string, string] => ["button", id, "buttonHandler"]),
  ["button", "queue_page:2", "buttonHandler"],
  ["button", "help_refresh", "buttonHandler"],
  ["button", "system_refresh", "buttonHandler"],
  ["button", "search_select_0", "buttonHandler"],
  ["button", "search_cancel", "buttonHandler"],
  ["button", "sb:toggle", "sponsorConfigHandler"],
  ["button", "sb:save", "sponsorConfigHandler"],
  ["button", "sb:cancel", "sponsorConfigHandler"],
  ["button", "djrole:save", "djRoleConfigHandler"],
  ["button", "djrole:cancel", "djRoleConfigHandler"],
  ["select", "autoplay_genre:u1:s1", "modalHandler"],
  ["select", "music_jumpto:u1:s1", "modalHandler"],
  ["select", "sb:cats", "sponsorConfigHandler"],
  ["select", "plm:ytp:PL1:10:a1:b:u1", "playlistMoreHandler"],
  ["roleSelect", "djrole:select", "djRoleConfigHandler"],
  ["modal", "volume_modal", "modalHandler"],
  ["modal", "plmm:ytp:PL1:10:a1:b:u1", "playlistMoreHandler"],
  ["command", "probe", "slashCommand"],
];

for (const [kind, customId, owner] of CASES) {
  test(`${kind} ${customId}: ${owner} 하나만 답한다`, async () => {
    const { who, threw } = await answerers(kind, customId);
    assert.deepEqual(threw, [], "리스너 밖으로 던지지 않는다");
    assert.deepEqual(who, [owner]);
  });
}

// 새 버튼 · 메뉴를 만들고 위 목록에 안 넣으면 여기서 걸린다. 모달 안의 입력 칸은 상호작용이 아니다
const INPUTS = new Set(["volume_input", "count"]);
test("코드가 만드는 custom_id 는 모두 위 목록에 있다", () => {
  const heads = new Set<string>();
  for (const dir of ["commands", "events", "src"]) {
    for (const file of fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      for (const m of fs.readFileSync(path.join(ROOT, dir, file), "utf8").matchAll(/setCustomId\(\s*[`"]([^`"$]*)/g)) if (m[1] && !INPUTS.has(m[1])) heads.add(m[1]);
    }
  }
  assert.ok(heads.size > 20, `읽은 custom_id 가 너무 적다(${heads.size})`);
  const missing = [...heads].filter((head) => !CASES.some(([, id]) => id.startsWith(head)));
  assert.deepEqual(missing, []);
});
