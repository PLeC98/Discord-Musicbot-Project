// dashboard/src/utils/settings-draft.ts: 서버 설정 화면의 저장 차례와 값 합치기. 저장 중에 고치거나 되돌린 것, 저장 중에 온 넛지,
// 답이 보낸 키만 바꾸는 것, 충돌과 실패의 갈래, 숫자 입력 중인 카드, 운영자 기본 구간을 따르는 구간을 지킨다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettingsSaver, fieldKeysOf, failureOf, inheritCategories, mergeRefresh, patchOf, valuesOf, type Failure } from "../../../dashboard/src/utils/settings-draft.ts";
import { valueAt, withValue, type SettingsKey, type SettingsValues } from "../../../src/rules/guild-settings-values.ts";
import type { GuildSettings, SettingsSaved } from "../../../src/dashboard/contract/guilds.ts";
import type { SettingsPatch } from "../../../src/dashboard/request-schemas.ts";

const DEFAULTS = ["music_offtopic", "intro", "outro"];

function settingsOf(values: SettingsValues, more: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildName: "서버",
    cards: ["channel", "dj", "sponsorblock", "playlistAdd"],
    channel: { botChannelId: values.botChannelId ?? null, channels: [] },
    dj: { djRoleIds: values.djRoleIds ?? [], roles: [] },
    sponsorblock: { masterEnabled: true, enabled: values.sponsorblock?.enabled ?? true, categories: values.sponsorblock?.categories ?? null, defaultCategories: DEFAULTS },
    playlistAdd: { value: values.playlistAddMax ?? null, effective: 50, min: 1, max: 500, default: 50 },
    ...more,
  };
}

// 문제 응답처럼 보이는 요청 오류
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ response: { status, data: { code, status, ...extra } } });

// 답을 시험이 정할 때까지 늦추는 가짜 화면
function harness(initial: SettingsValues) {
  let form: SettingsValues = { ...initial };
  const sent: SettingsPatch[] = [];
  const pendingSends: Array<{ resolve: (saved: SettingsSaved) => void; reject: (error: unknown) => void }> = [];
  const pendingFetches: Array<{ resolve: (data: GuildSettings) => void; reject: (error: unknown) => void }> = [];
  const failures: Failure["kind"][] = [];
  let hold: SettingsKey[] = [];
  let lost = false;
  const saver = createSettingsSaver(
    {
      send: (patch) => {
        sent.push(patch);
        return new Promise((resolve, reject) => pendingSends.push({ resolve, reject }));
      },
      fetch: () => new Promise((resolve, reject) => pendingFetches.push({ resolve, reject })),
      read: () => form,
      write: (values, keys) => {
        // 화면처럼: 구간이 null(운영자 기본을 따름)이면 기본 구간을 보인다
        for (const key of keys) {
          const value = valueAt(values, key);
          form = withValue(form, key, key === "sponsorblock.categories" && value === null ? [...DEFAULTS] : value);
        }
      },
      hold: () => hold,
      settings: () => {},
      saving: () => {},
      saved: () => {},
      failed: (_error, failure) => failures.push(failure.kind),
      lost: () => (lost = true),
    },
    { debounceMs: 0 },
  );
  saver.load(settingsOf(initial));
  return {
    saver,
    sent,
    failures,
    get form() {
      return form;
    },
    edit(key: SettingsKey, value: unknown) {
      form = withValue(form, key, value);
      saver.edited();
    },
    setHold: (keys: SettingsKey[]) => (hold = keys),
    answer: (values: SettingsValues) => pendingSends.shift()!.resolve({ values }),
    fail: (error: unknown) => pendingSends.shift()!.reject(error),
    giveSettings: (values: SettingsValues, more: Partial<GuildSettings> = {}) => pendingFetches.shift()!.resolve(settingsOf(values, more)),
    failFetch: (error: unknown) => pendingFetches.shift()!.reject(error),
    get fetches() {
      return pendingFetches.length;
    },
    get lost() {
      return lost;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("보낼 본문: 고친 키만, 키마다 기준값(from)과 고치는 값(to). SponsorBlock 은 하위 키로", () => {
  const base: SettingsValues = { botChannelId: null, djRoleIds: ["r1"], sponsorblock: { enabled: true, categories: null } };
  const draft = withValue(withValue(base, "djRoleIds", ["r2"]), "sponsorblock.enabled", false);
  assert.deepEqual(patchOf(base, draft, ["djRoleIds", "sponsorblock.enabled"]), { djRoleIds: { from: ["r1"], to: ["r2"] }, sponsorblock: { enabled: { from: true, to: false } } });
  assert.equal(patchOf(base, draft, []), null);
});

test("받은 설정은 보이는 카드의 키만 값으로 삼는다(꺼진 연령 제한 카드는 없다)", () => {
  const values = valuesOf(settingsOf({ botChannelId: "c1" }));
  assert.equal(valueAt(values, "agePlace"), undefined);
  assert.equal(valueAt(values, "botChannelId"), "c1");
});

test("다시 읽은 값: 고치는 중인 키는 두고, 새로 보인 카드는 기준값과 함께 채우고, 사라진 카드는 뺀다", () => {
  const base: SettingsValues = { botChannelId: "c1", djRoleIds: ["r1"] };
  const draft = withValue(base, "botChannelId", "c2");
  const merged = mergeRefresh(base, draft, { botChannelId: "c3", agePlace: "all" });
  assert.equal(valueAt(merged.draft, "botChannelId"), "c2", "고치는 중");
  assert.equal(valueAt(merged.base, "botChannelId"), "c3");
  assert.deepEqual([valueAt(merged.base, "agePlace"), valueAt(merged.draft, "agePlace")], ["all", "all"]);
  assert.equal(valueAt(merged.draft, "djRoleIds"), undefined, "사라진 카드");
  assert.deepEqual(merged.touched, ["agePlace"]);
});

test("운영자 기본 구간을 따르던 서버에서 눌렀다 되돌리면 다시 따르는 것(null)으로 본다", () => {
  const base: SettingsValues = { sponsorblock: { enabled: true, categories: null } };
  assert.equal(valueAt(inheritCategories(base, withValue(base, "sponsorblock.categories", ["outro", "intro", "music_offtopic"]), DEFAULTS), "sponsorblock.categories"), null);
  assert.deepEqual(valueAt(inheritCategories(base, withValue(base, "sponsorblock.categories", ["intro"]), DEFAULTS), "sponsorblock.categories"), ["intro"]);
});

test("필드 오류의 키: 맨 위 코드(전용 채널, 역할 수)와 bad-settings 의 pointer. 하위 키를 가리키지 않는 sponsorblock 은 둘 다, 모르는 위치면 고르지 않는다", () => {
  assert.deepEqual(fieldKeysOf({ code: "bad-bot-channel" }), ["botChannelId"]);
  assert.deepEqual(fieldKeysOf({ code: "too-many-dj-roles" }), ["djRoleIds"]);
  assert.deepEqual(fieldKeysOf({ code: "bad-settings", errors: [{ pointer: "/playlistAddMax/to" }] }), ["playlistAddMax"]);
  assert.deepEqual(fieldKeysOf({ code: "bad-settings", errors: [{ pointer: "/sponsorblock/categories/to/0" }] }), ["sponsorblock.categories"]);
  assert.deepEqual(fieldKeysOf({ code: "bad-settings", errors: [{ pointer: "/sponsorblock" }] }), ["sponsorblock.enabled", "sponsorblock.categories"]);
  assert.deepEqual(fieldKeysOf({ code: "bad-settings", errors: [{ pointer: "" }] }), []);
});

test("실패의 갈래는 문제 코드로: 충돌은 conflicts 가 있는 config-changed 만, account-changed 같은 다른 409 는 그 밖", () => {
  assert.equal(failureOf(problem(409, "config-changed", { conflicts: ["djRoleIds"], current: {} })).kind, "conflict");
  assert.equal(failureOf(problem(409, "account-changed")).kind, "other");
  assert.equal(failureOf(problem(403, "must-server-manager")).kind, "permission");
  assert.equal(failureOf(problem(404, "guild-not-found")).kind, "gone");
  assert.equal(failureOf(problem(500, "settings-save-failed")).kind, "other");
  assert.equal(failureOf(new Error("network")).kind, "other");
});

test("저장 중에 값을 원래대로 되돌리면, 저장이 끝난 뒤 그 되돌림을 다시 저장한다", async () => {
  const h = harness({ botChannelId: "a" });
  h.edit("botChannelId", "b");
  await tick();
  assert.equal(h.sent.length, 1);
  h.edit("botChannelId", "a"); // 저장 중에 되돌림
  h.answer({ botChannelId: "b" });
  await tick();
  assert.deepEqual(h.sent[1], { botChannelId: { from: "b", to: "a" } });
});

test("요청은 한 번에 하나: 저장 중에 온 넛지는 저장이 끝난 뒤 다시 읽고, 고치는 중인 키는 다시 읽은 값으로 덮지 않는다", async () => {
  const h = harness({ botChannelId: "a", djRoleIds: [] });
  h.edit("botChannelId", "b");
  await tick();
  h.saver.nudged();
  assert.equal(h.fetches, 0, "저장 중에는 읽지 않는다");
  h.edit("djRoleIds", ["r9"]); // 저장 중에 다른 카드를 고침
  h.answer({ botChannelId: "b" });
  await tick();
  assert.equal(h.fetches, 1, "저장이 끝난 뒤 다시 읽는다");
  h.giveSettings({ botChannelId: "z", djRoleIds: ["r1"] });
  await tick();
  assert.equal(valueAt(h.form, "botChannelId"), "z", "고치는 중이 아닌 키는 따라간다");
  assert.deepEqual(valueAt(h.form, "djRoleIds"), ["r9"], "고치는 중인 키는 둔다");
  assert.deepEqual(h.sent.at(-1), { djRoleIds: { from: ["r1"], to: ["r9"] } }, "다시 읽은 값을 기준으로 보낸다");
});

test("저장의 답은 보낸 키만, 서버가 거른 값으로 받아들인다(걸러진 역할이 화면에서도 빠진다)", async () => {
  const h = harness({ djRoleIds: [], botChannelId: "a" });
  h.edit("djRoleIds", ["r1", "ghost"]);
  await tick();
  h.answer({ djRoleIds: ["r1"] });
  await tick();
  assert.deepEqual(valueAt(h.form, "djRoleIds"), ["r1"]);
  assert.deepEqual(h.saver.unsaved(), []);
});

test("충돌: 부딪힌 키만 지금 값으로 바꾸고, 같은 저장의 다른 키는 다시 보낸다", async () => {
  const h = harness({ djRoleIds: ["r1"], playlistAddMax: null });
  h.edit("djRoleIds", ["r2"]);
  h.edit("playlistAddMax", 80);
  await tick();
  h.fail(problem(409, "config-changed", { conflicts: ["djRoleIds"], current: { djRoleIds: ["r1", "r3"] } }));
  await tick();
  assert.deepEqual(valueAt(h.form, "djRoleIds"), ["r1", "r3"]);
  assert.deepEqual(h.sent[1], { playlistAddMax: { from: null, to: 80 } });
  assert.deepEqual(h.failures, ["conflict"]);
});

test("저장 실패(500)는 저절로 다시 보내지 않는다(다시 읽은 값을 넣어도). 떠날 때는 한 번 더 보낸다", async () => {
  const h = harness({ botChannelId: "a", djRoleIds: [] });
  h.edit("botChannelId", "b");
  await tick();
  h.fail(problem(500, "settings-save-failed"));
  await tick();
  h.saver.nudged();
  await tick();
  h.giveSettings({ botChannelId: "a", djRoleIds: ["r5"] }); // 다른 카드가 다시 읽혀 바뀐다
  await tick();
  assert.equal(h.sent.length, 1, "되풀이하지 않는다");
  const left = h.saver.flush();
  await tick();
  assert.equal(h.sent.length, 2);
  h.answer({ botChannelId: "b" });
  assert.deepEqual(await left, []);
});

test("필드 오류(400)는 그 키만 막고 다른 키는 보낸다. 사람이 그 키를 다시 고치면 풀린다", async () => {
  const h = harness({ botChannelId: "a", playlistAddMax: null });
  h.edit("botChannelId", "gone");
  h.edit("playlistAddMax", 30);
  await tick();
  h.fail(problem(400, "bad-bot-channel"));
  await tick();
  assert.deepEqual(h.sent[1], { playlistAddMax: { from: null, to: 30 } });
  h.answer({ playlistAddMax: 30 });
  await tick();
  h.edit("botChannelId", "c2");
  await tick();
  assert.deepEqual(h.sent[2], { botChannelId: { from: "a", to: "c2" } });
});

test("권한이 바뀌었으면(403) 다시 읽고, 서버가 사라지면 멈추고 고친 것을 남기지 않는다(떠날 때 묻지 않는다)", async () => {
  const h = harness({ botChannelId: "a" });
  h.edit("botChannelId", "b");
  await tick();
  h.fail(problem(403, "must-server-manager"));
  await tick();
  assert.equal(h.fetches, 1);
  h.failFetch(problem(404, "guild-not-found"));
  await tick();
  assert.equal(h.lost, true);
  assert.deepEqual(h.saver.unsaved(), []);
  assert.deepEqual(await h.saver.flush(), []);
});

test("숫자 입력 중인 카드는 보내지 않고 다른 카드는 저장한다. 떠날 때는 그 카드도 물을 것으로 남는다", async () => {
  const h = harness({ botChannelId: "a", playlistAddMax: null });
  h.setHold(["playlistAddMax"]);
  h.edit("playlistAddMax", 7);
  h.edit("botChannelId", "b");
  await tick();
  assert.deepEqual(h.sent, [{ botChannelId: { from: "a", to: "b" } }]);
  h.answer({ botChannelId: "b" });
  await tick();
  assert.deepEqual(h.saver.unsaved(), ["playlistAddMax"]);
});

test("다시 읽기로 새로 보인 카드는 고친 것으로 잡히지 않는다(입력의 기본값을 보내지 않는다)", async () => {
  const h = harness({ botChannelId: "a" });
  h.saver.nudged();
  await tick();
  h.giveSettings({ botChannelId: "a" }, { cards: ["channel", "dj", "sponsorblock", "playlistAdd", "agePlace"], agePlace: "all" });
  await tick();
  assert.equal(valueAt(h.form, "agePlace"), "all");
  assert.deepEqual(h.saver.unsaved(), []);
  assert.equal(h.sent.length, 0);
});
