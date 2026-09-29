// 상호작용 입구 하나(events/interactionCreate). 봇이 만드는 모든 custom_id · 모달 · 선택 메뉴가 정해진 처리기 하나로 가고,
// 정확히 한 번 답하는지 본다. 두 번 답하면 늦은 쪽이 40060 으로 터지고, 아무도 안 답하면 사용자는 "상호작용 실패"를 본다.

import fs from "node:fs";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Collection, type Interaction } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/tempStore.ts";
import { useExampleConfig } from "../helpers/exampleConfig.ts";
import { buildGenreMenu, buildAutoplayOffMenu } from "../../src/ui/genreMenu.ts";
import { MusicEmbedManager } from "../../src/ui/nowPlayingPanel.ts";
import * as tracks from "../helpers/tracks.ts";
import interactionCreate from "../../events/interactionCreate.ts";
import { ROUTES } from "../../interactions/index.ts";
import { routeOf, type Kind as RouteKind } from "../../interactions/route.ts";
import { routes as buttonHandler, volumeModal } from "../../interactions/buttonHandler.ts";
import { routes as djRoleConfigHandler } from "../../interactions/djRoleConfigHandler.ts";
import { routes as modalHandler } from "../../interactions/modalHandler.ts";
import { routes as playlistMoreHandler } from "../../interactions/playlistMoreHandler.ts";
import { routes as sponsorConfigHandler } from "../../interactions/sponsorConfigHandler.ts";

useExampleConfig();
const store = openTempStore("listeners-");
after(() => store.close());

const ROOT = path.join(import.meta.dirname, "..", "..");
const OWNERS = { buttonHandler, djRoleConfigHandler, modalHandler, playlistMoreHandler, sponsorConfigHandler };

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

// 이 custom_id 를 받는 처리기 모듈의 이름
function ownerOf(kind: Kind, customId: string) {
  if (kind === "command") return "commands";
  const route = routeOf(ROUTES, kind as RouteKind, customId);
  return Object.entries(OWNERS).find(([, routes]) => route && routes.includes(route))?.[0] ?? null;
}

// 입구에 태워 처음 답한 방법들을 모은다. 미룬 뒤 고치기 · 이어 보내기는 한 답의 뒷부분이라 세지 않는다
const FIRST = new Set(["reply", "deferReply", "deferUpdate", "update", "showModal"]);
async function answers(kind: Kind, customId: string) {
  const answered: string[] = [];
  await interactionCreate.execute(interaction(kind, customId, answered));
  return answered.filter((a) => FIRST.has(a));
}

const PANEL = ["pause", "skip", "previous", "stop", "shuffle", "queue", "loop", "highlight", "volume", "autoplay"].map((n) => `panel:${n}:s1`);
const CASES: [Kind, string, string][] = [
  ...PANEL.map((id): [Kind, string, string] => ["button", id, "buttonHandler"]),
  ["button", "queue:page:2", "buttonHandler"],
  ["button", "help:refresh", "buttonHandler"],
  ["button", "system:refresh", "buttonHandler"],
  ["button", "search_select_0", "buttonHandler"],
  ["button", "search_cancel", "buttonHandler"],
  ["button", "sb:toggle", "sponsorConfigHandler"],
  ["button", "sb:save", "sponsorConfigHandler"],
  ["button", "sb:cancel", "sponsorConfigHandler"],
  ["button", "djrole:save", "djRoleConfigHandler"],
  ["button", "djrole:cancel", "djRoleConfigHandler"],
  ["select", "autoplay:genre", "modalHandler"],
  ["select", "panel:jump:s1", "modalHandler"],
  ["select", "sb:cats", "sponsorConfigHandler"],
  ["select", "plm:ytp:PL1:10:a1:b:u1", "playlistMoreHandler"],
  ["roleSelect", "djrole:select", "djRoleConfigHandler"],
  ["modal", "panel:volume", "modalHandler"],
  ["modal", "plmm:ytp:PL1:10:a1:b:u1", "playlistMoreHandler"],
  ["command", "probe", "commands"],
];

for (const [kind, customId, owner] of CASES) {
  test(`${kind} ${customId}: ${owner} 가 받아 한 번 답한다`, async () => {
    assert.equal(ownerOf(kind, customId), owner);
    const answered = await answers(kind, customId);
    assert.equal(answered.length, 1, answered.join(", "));
  });
}

// 위 목록은 글자를 적어 둔 것이라, 만드는 쪽의 custom_id 가 바뀌면 모른다. 만든 것을 받는 경로가 목록의 것과 같은지 본다
test("봇이 만드는 모달 · 메뉴의 custom_id 는 목록의 그 경로로 간다", async () => {
  const sameRoute = (kind: RouteKind, built: string, listed: string) => assert.equal(routeOf(ROUTES, kind, built), routeOf(ROUTES, kind, listed), built);
  sameRoute("modal", volumeModal().toJSON().custom_id, "panel:volume");
  for (const menu of [buildGenreMenu(), buildAutoplayOffMenu()]) sameRoute("select", menu.components[0].toJSON().components[0].custom_id, "autoplay:genre");
  const jump = await new MusicEmbedManager(fake({ players: new Map() })).createJumpToRow({ sessionId: "s1", queue: [tracks.youtube("aaaaaaaaaaa")] });
  sameRoute("select", jump?.toJSON().components[0].custom_id ?? "", "panel:jump:s1");
});

test("처리기가 없는 custom_id 는 모른다고 한 번 답한다", async () => {
  assert.deepEqual(await answers("button", "nobody_knows"), ["reply"]);
  assert.deepEqual(await answers("modal", "nobody_knows"), ["reply"]);
});

test("앞머리가 여럿 맞으면 더 좁은 처리기가 받는다(자동재생 버튼은 재생 패널 버튼보다 좁다)", () => {
  const panel = routeOf(ROUTES, "button", "panel:skip:s1");
  const autoplay = routeOf(ROUTES, "button", "panel:autoplay:s1");
  assert.ok(panel && autoplay && panel !== autoplay);
  assert.equal(autoplay.prefix, "panel:autoplay:");
});

// 새 처리기를 만들고 위 목록에 안 넣으면 여기서 걸린다. 경로표의 처리기마다 그것을 고르는 custom_id 가 목록에 있어야 한다
test("경로표의 처리기는 모두 위 목록에서 불린다", () => {
  const unused = ROUTES.filter((r) => !CASES.some(([kind, id]) => kind === r.kind && routeOf(ROUTES, r.kind, id) === r));
  assert.deepEqual(
    unused.map((r) => `${r.kind} ${r.prefix}`),
    [],
  );
});

// custom_id 를 글자 그대로 적은 곳(ui/customIds 를 거치지 않은 것)도 목록이 덮는다. 모달 안의 입력 칸은 상호작용이 아니다
const INPUTS = new Set(["volume_input", "count"]);
test("글자 그대로 적은 custom_id 도 모두 위 목록에 있다", () => {
  const heads = new Set<string>();
  for (const dir of ["commands", "events", "interactions", "src"]) {
    for (const file of fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      for (const m of fs.readFileSync(path.join(ROOT, dir, file), "utf8").matchAll(/setCustomId\(\s*[`"]([^`"$]*)/g)) if (m[1] && !INPUTS.has(m[1])) heads.add(m[1]);
    }
  }
  assert.ok(heads.size >= 5, `읽은 custom_id 가 너무 적다(${heads.size})`);
  const missing = [...heads].filter((head) => !CASES.some(([, id]) => id.startsWith(head)));
  assert.deepEqual(missing, []);
});

test("종류가 다르면 앞머리가 맞아도 받지 않는다(버튼 앞머리의 메뉴 · 모달)", () => {
  assert.equal(routeOf(ROUTES, "select", "panel:skip:s1"), null);
  assert.equal(routeOf(ROUTES, "modal", "sb:toggle"), null);
  assert.ok(routeOf(ROUTES, "button", "sb:toggle"));
});
