// events/djRoleConfigHandler.ts — /setdjrole GUI (드롭메뉴 선택 보류 → 저장/취소 확정) 흐름.
// 서버 설정은 진짜를 임시 DB 로 쓴다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type ButtonInteraction, type RoleSelectMenuInteraction } from "discord.js";

import { openTempStore, setGuild } from "../helpers/tempStore.ts";
const temp = openTempStore("dj-role-");
after(() => temp.close());
const settings = await import("../../src/store/guildSettings.ts");
const { fakeWith } = await import("../helpers/fake.ts");

// 저장된 DJ 역할을 표에서 바로 읽고 쓴다(Map 과 같은 모양)
const store = {
  djRoles: {
    get: (g: string) => {
      const ids = settings.table.getDjRoles(g);
      return ids.length ? ids : undefined;
    },
    has: (g: string) => settings.table.getDjRoles(g).length > 0,
    set: (g: string, ids: string[]) => setGuild(g, { djRoles: ids }),
    delete: (g: string) => setGuild(g, { djRoles: [] }),
  },
};

const handler = (await import("../../events/djRoleConfigHandler.ts")).default;

const guild = { id: "g1", roles: { cache: { has: (id: string) => ["r1", "r2"].includes(id) } } };

type Updated = { components: unknown[]; embeds: { data: { title: string } }[] };

function fakeInteraction({ type, customId, values = [] as string[], messageId = "m1", canManage = true }: { type: "select" | "button"; customId: string; values?: string[]; messageId?: string; canManage?: boolean }) {
  const ix = fakeWith<ButtonInteraction | RoleSelectMenuInteraction>()({
    customId,
    values,
    guild,
    message: { id: messageId },
    memberPermissions: { has: (p: bigint) => canManage && p === PermissionFlagsBits.ManageGuild },
    isRoleSelectMenu: () => type === "select",
    isButton: () => type === "button",
    inCachedGuild: () => true,
    repliedWith: null as { content: string } | null,
    updatedWith: null as Updated | null,
    deferredUpdate: false,
    async reply(payload: { content: string }) {
      ix.repliedWith = payload;
    },
    async update(payload: Updated) {
      ix.updatedWith = payload;
    },
    async deferUpdate() {
      ix.deferredUpdate = true;
    },
  });
  return ix;
}

test("무관한 인터랙션(다른 customId)은 무시", async () => {
  const ix = fakeInteraction({ type: "button", customId: "music_pause:x:y" });
  await handler.execute(ix);
  assert.equal(ix.repliedWith, null);
  assert.equal(ix.updatedWith, null);
});

test("권한 없는 유저는 거부 (심층 방어)", async () => {
  const ix = fakeInteraction({ type: "button", customId: "djrole:save", canManage: false });
  await handler.execute(ix);
  assert.ok(ix.repliedWith?.content.includes("서버 관리 권한"));
});

test("선택 → 저장: 보류된 선택값이 확정됨", async () => {
  store.djRoles.delete("g1");

  const select = fakeInteraction({ type: "select", customId: "djrole:select", values: ["r1", "r2"], messageId: "mA" });
  await handler.execute(select);
  assert.equal(select.deferredUpdate, true, "선택은 저장하지 않고 보류만 (deferUpdate)");
  assert.equal(store.djRoles.has("g1"), false, "저장 전에는 미반영");

  const save = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mA" });
  await handler.execute(save);
  assert.deepEqual(store.djRoles.get("g1"), ["r1", "r2"]);
  assert.equal(save.updatedWith?.components.length, 0, "저장 후 컴포넌트 제거");
  assert.ok(save.updatedWith?.embeds[0].data.title.includes("설정됨"));
});

test("선택 없이 저장: 현재 설정 유지 (no-op에 가깝게 재저장)", async () => {
  store.djRoles.set("g1", ["r1"]);
  const save = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mB" });
  await handler.execute(save);
  assert.deepEqual(store.djRoles.get("g1"), ["r1"]);
});

test("전부 해제하고 저장: 제한 해제", async () => {
  store.djRoles.set("g1", ["r1"]);

  const select = fakeInteraction({ type: "select", customId: "djrole:select", values: [], messageId: "mC" });
  await handler.execute(select);
  const save = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mC" });
  await handler.execute(save);

  assert.equal(store.djRoles.has("g1"), false);
  assert.ok(save.updatedWith?.embeds[0].data.title.includes("해제"));
});

test("선택~저장 사이 삭제된 역할은 걸러서 저장", async () => {
  const select = fakeInteraction({ type: "select", customId: "djrole:select", values: ["r1", "deleted"], messageId: "mD" });
  await handler.execute(select);
  const save = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mD" });
  await handler.execute(save);
  assert.deepEqual(store.djRoles.get("g1"), ["r1"]);
});

test("취소: 보류 선택 폐기, 설정 무변경", async () => {
  store.djRoles.set("g1", ["r1"]);

  const select = fakeInteraction({ type: "select", customId: "djrole:select", values: ["r2"], messageId: "mE" });
  await handler.execute(select);
  const cancel = fakeInteraction({ type: "button", customId: "djrole:cancel", messageId: "mE" });
  await handler.execute(cancel);

  assert.deepEqual(store.djRoles.get("g1"), ["r1"], "설정 무변경");
  assert.ok(cancel.updatedWith?.embeds[0].data.title.includes("취소"));

  // 취소 후 저장을 눌러도(다른 세션 가정) 폐기된 선택이 부활하지 않음
  const save = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mE" });
  await handler.execute(save);
  assert.deepEqual(store.djRoles.get("g1"), ["r1"]);
});

test("메시지별 보류 분리: 다른 메시지의 선택이 섞이지 않음", async () => {
  store.djRoles.delete("g1");

  await handler.execute(fakeInteraction({ type: "select", customId: "djrole:select", values: ["r1"], messageId: "mF" }));
  await handler.execute(fakeInteraction({ type: "select", customId: "djrole:select", values: ["r2"], messageId: "mG" }));

  const saveF = fakeInteraction({ type: "button", customId: "djrole:save", messageId: "mF" });
  await handler.execute(saveF);
  assert.deepEqual(store.djRoles.get("g1"), ["r1"], "mF의 선택만 반영");
});
