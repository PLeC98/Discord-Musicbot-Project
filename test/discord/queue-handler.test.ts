// src/discord/interactions/queue-handler.ts: /queue 화면의 버튼, 메뉴. 누른 때의 대기열로 하고 다시 그리며, 곡 버튼의 결과는 모두에게 알린다.
// 플레이어는 대기열만 진짜처럼 바뀌는 가짜, 권한 검사는 실제 판정 함수에 가짜 멤버를 넘긴다(서버 관리자는 통과, 봇과 다른 채널에 있으면 거절)

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { MessageFlags, type Guild, type GuildMember, type RepliableInteraction } from "discord.js";
import { openQueue, WAIT } from "../../src/discord/commands/queue.ts";
import * as thumbnails from "../../src/ui/queue-mosaic/thumbnails.ts";
import { ROUTES } from "../../src/discord/interactions/index.ts";
import { routeOf, type Kind } from "../../src/discord/interactions/route.ts";
import * as playerEvents from "../../src/player/events.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakeBot, fakePlayer } from "../helpers/fake.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { textOf } from "../helpers/cv2.ts";

useDefaultDocuments();
const store = openTempStore("queue-handler-");
after(() => store.close());
afterEach(() => playerEvents._reset());

const guild = fake<Guild>({ id: "g1", name: "서버", members: { me: { voice: { channel: { id: "vc1" } } } }, roles: { cache: new Map() } });
const member = ({ mod = true, inVoice = true } = {}) => fake<GuildMember>({ id: "u1", user: { id: "u1", tag: "사람" }, guild, permissions: { has: () => mod }, voice: { channel: inVoice ? { id: "vc1" } : null }, roles: { cache: new Map() } });

const song = (entry: number): QueuedTrack => Object.defineProperty({ title: `곡${entry}`, pageUrl: `https://y/${entry}`, requestKey: `k${entry}`, platform: "youtube", duration: 60, thumbnail: null }, "entry", { value: entry, enumerable: false });

function player(entries: number[]) {
  const p = {
    guild,
    sessionId: "S",
    currentTrack: song(1),
    queue: entries.map(song),
    previousTracks: [],
    loop: false,
    paused: false,
    isLive: false,
    isPlayStarting: false,
    getCurrentTime: () => 0,
    moveInQueue: (f: number, t: number) => (p.queue.splice(t, 0, p.queue.splice(f, 1)[0]), true),
    removeFromQueue: (tracks: QueuedTrack[]) => {
      const gone = new Set(tracks);
      const removed = p.queue.filter((t) => gone.has(t));
      p.queue = p.queue.filter((t) => !gone.has(t));
      return removed;
    },
    // 진짜처럼 지금 곡을 멈추기만 한다(다음 곡은 곡 끝 처리가 꺼낸다)
    skip: () => true,
  };
  return fakePlayer(p);
}
const order = (p: { queue: QueuedTrack[] }) => p.queue.map((t) => t.entry);

type Pressed = { calls: string[]; payloads: Array<{ attachments?: unknown[] }>; run: Promise<unknown> };

/** 화면의 버튼, 메뉴를 누른다. release를 주면 deferUpdate가 그것을 기다린다 */
function press(kind: Kind, customId: string, p: unknown, { values = [] as string[], who = member(), release = null as Promise<void> | null, typed = "" } = {}): Pressed {
  const calls: string[] = [];
  const payloads: Pressed["payloads"] = [];
  const it = {
    customId,
    values,
    guild,
    member: who,
    user: { id: "u1" },
    message: { id: "M", flags: { has: () => true }, interactionMetadata: null },
    replied: false,
    deferred: false,
    isChatInputCommand: () => false,
    isMessageComponent: () => true,
    isFromMessage: () => true,
    update: async (payload: Pressed["payloads"][number]) => (calls.push("update"), payloads.push(payload), (it.replied = true)),
    deferUpdate: async () => {
      calls.push("deferUpdate");
      it.deferred = true;
      await release;
    },
    editReply: async (payload: Pressed["payloads"][number]) => (calls.push("editReply"), payloads.push(payload)),
    deleteReply: async () => calls.push("delete"),
    reply: async () => (calls.push("reply"), (it.replied = true)),
    followUp: async () => (calls.push("followUp"), { id: "F" }),
    showModal: async () => calls.push("showModal"),
    fields: { getTextInputValue: () => typed },
    channel: { send: async (payload: unknown) => (calls.push(`send:${textOf(payload)}`), { id: "C", delete: async () => {} }) },
  };
  const bot = fakeBot({ players: new Map([["g1", p]]) });
  const route = routeOf(ROUTES, kind, customId);
  assert.ok(route, customId);
  return { calls, payloads, run: Promise.resolve(route.handle(fake(it), bot)) };
}

const idsOf = (payload: unknown): string[] => JSON.stringify(payload).match(/queue:[a-z]+:[^"]*/g) ?? [];

test("위로: 바로 앞 곡 앞으로 옮기고, 그 곡을 고른 채로 다시 그리고(이미지 없이), 모두에게 알린다", async () => {
  const p = player([11, 12, 13]);
  const done = press("button", "queue:do:up:13:1:S", p);
  await done.run;
  assert.deepEqual(order(p), [11, 13, 12]);
  assert.equal(done.calls[0], "update");
  assert.ok(done.calls[1].startsWith("send:") && done.calls[1].includes("곡13"), done.calls[1]);
  assert.deepEqual(done.payloads[0].attachments, []);
  assert.ok(idsOf(done.payloads[0]).includes("queue:do:up:13:1:S"), "고른 채로");
});

test("다음에 재생은 맨 앞으로, 아래로는 한 칸 뒤로. 맨 앞의 위로는 옮기지 않고 다시 그리기만", async () => {
  const p = player([11, 12, 13]);
  await press("button", "queue:do:next:13:1:S", p).run;
  assert.deepEqual(order(p), [13, 11, 12]);
  await press("button", "queue:do:down:11:1:S", p).run;
  assert.deepEqual(order(p), [13, 12, 11]);
  const stay = press("button", "queue:do:up:13:1:S", p);
  await stay.run;
  assert.deepEqual([order(p), stay.calls], [[13, 12, 11], ["update"]]);
});

test("옮긴 곡이 다른 페이지로 가면 그 페이지를 그린다", async () => {
  const p = player(Array.from({ length: 12 }, (_, i) => 101 + i));
  const done = press("button", "queue:do:down:110:1:S", p);
  await done.run;
  assert.equal(order(p)[10], 110);
  assert.ok(idsOf(done.payloads[0]).includes("queue:do:down:110:2:S"), idsOf(done.payloads[0]).join(" "));
});

test("삭제로 대기열이 비면 화면을 지우고 결과만 알린다. 남으면 고르지 않은 채로 다시 그린다", async () => {
  const p = player([11, 12]);
  const first = press("button", "queue:do:remove:11:1:S", p);
  await first.run;
  assert.equal(first.calls[0], "update");
  assert.ok(!idsOf(first.payloads[0]).some((id) => id.startsWith("queue:do:")), "고르지 않은 채로");
  const last = press("button", "queue:do:remove:12:1:S", p);
  await last.run;
  assert.deepEqual(last.calls.slice(0, 2), ["deferUpdate", "delete"]);
  assert.ok(last.calls[2].startsWith("send:"));
});

test("지금 재생: 그 곡을 맨 앞에 두고 넘긴다. 곡 끝 처리가 꺼내기 전이어도 그 곡을 뺀 목록을 고르지 않은 채로 그린다", async () => {
  const p = player([11, 12, 13]);
  const done = press("button", "queue:do:play:12:1:S", p);
  await done.run;
  assert.deepEqual(order(p), [12, 11, 13], "꺼내는 것은 곡 끝 처리");
  assert.deepEqual(
    done.calls.map((c) => c.split(":")[0]),
    ["update", "send"],
  );
  const text = textOf({ components: (done.payloads[0] as { components: Array<{ toJSON(): unknown }> }).components });
  assert.ok(text.includes("`1` **[곡11]") && !text.includes("[곡12]"), text);

  const last = press("button", "queue:do:play:21:1:S", player([21]));
  await last.run;
  assert.deepEqual(
    last.calls.map((c) => c.split(":")[0]),
    ["deferUpdate", "delete", "send"],
    "마지막 곡이면 화면을 지운다",
  );
});

test("거절: 지난 세션, 권한 없음은 화면을 그대로 두고 본인에게. 그 곡이 이미 빠졌으면 다시 그리고 알린다", async () => {
  const p = player([11, 12]);
  const stale = press("button", "queue:do:remove:11:1:OLD", p);
  await stale.run;
  assert.deepEqual([stale.calls, order(p)], [["reply"], [11, 12]]);
  const outsider = press("button", "queue:do:up:12:1:S", p, { who: member({ mod: false, inVoice: false }) });
  await outsider.run;
  assert.deepEqual([outsider.calls, order(p)], [["reply"], [11, 12]]);
  const gone = press("button", "queue:do:down:99:1:S", p);
  await gone.run;
  assert.deepEqual(gone.calls, ["update", "followUp"]);
});

test("곡 고르기: 고른 곡이 있는 페이지를 그 곡을 고른 채로", async () => {
  const p = player(Array.from({ length: 12 }, (_, i) => 101 + i));
  const done = press("select", "queue:pick:1:S", p, { values: ["entry:111"] });
  await done.run;
  assert.ok(idsOf(done.payloads[0]).includes("queue:do:play:111:2:S"));
});

test("보기 화면이 썸네일을 기다리는 사이 같은 메시지를 다른 것이 고쳤으면 늦은 보기 화면은 버린다", async () => {
  const p = player([11, 12, 13]);
  let open!: () => void;
  const browse = press("button", "queue:page:1", p, { release: new Promise<void>((resolve) => (open = resolve)) });
  const edit = press("button", "queue:edit:1", p);
  await edit.run;
  open();
  await browse.run;
  assert.deepEqual(browse.calls, ["deferUpdate"], "고치지 않는다");
  assert.deepEqual(edit.calls, ["update"]);
  const alone = press("button", "queue:page:1", p);
  await alone.run;
  assert.deepEqual(alone.calls, ["deferUpdate", "editReply"]);
  assert.deepEqual(alone.payloads[0].attachments, []);
});

test("페이지 버튼은 모달을 열고, 모달은 적은 페이지(범위 안으로)를, 숫자가 아니면 보던 페이지를 그린다", async () => {
  const p = player(Array.from({ length: 25 }, (_, i) => 101 + i));
  const button = press("button", "queue:goto:edit:2", p);
  await button.run;
  assert.deepEqual(button.calls, ["showModal"]);
  for (const [typed, shown] of [
    ["9", "queue:goto:edit:3"],
    ["x", "queue:goto:edit:2"],
  ]) {
    const modal = press("modal", "queue:goto:edit:2", p, { typed });
    await modal.run;
    assert.deepEqual(modal.calls, ["update"], typed);
    assert.ok(idsOf(modal.payloads[0]).includes(shown), `${typed}: ${idsOf(modal.payloads[0]).join(" ")}`);
  }
  const browse = press("modal", "queue:goto:browse:1", p, { typed: "2" });
  await browse.run;
  assert.deepEqual(browse.calls, ["deferUpdate", "editReply"]);
});

test("열기: 썸네일이 제때 오면 모자이크를 붙이고, 늦으면 기다리는 시간 뒤 이미지 없이 답한다(본인에게만, Components V2)", async () => {
  const jpeg = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#369" } })
    .jpeg()
    .toBuffer();
  const withArt = (entries: number[]) => {
    const p = player(entries);
    for (const t of p.queue) t.thumbnail = `https://i.ytimg.com/vi/openvideo${t.entry}/mqdefault.jpg`;
    return p;
  };
  const replied: Array<{ files?: Array<{ name: string }>; flags?: unknown }> = [];
  const it = (calls: string[]) => fake<RepliableInteraction<"cached">>({ id: `o${calls.length}`, member: member(), replied: false, deferred: false, isChatInputCommand: () => true, reply: async (payload: (typeof replied)[number]) => (calls.push("reply"), replied.push(payload)) });

  thumbnails._internals.useFetch(async () => jpeg);
  await openQueue(it([]), withArt([11, 12]));
  assert.deepEqual(
    replied[0].files?.map((f) => f.name),
    ["queue.webp"],
  );
  assert.deepEqual([replied[0].flags].flat(), [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);

  thumbnails._internals.useFetch(() => new Promise(() => {}));
  const started = performance.now();
  await openQueue(it([]), withArt([21, 22]));
  const waited = performance.now() - started;
  assert.equal(replied[1].files, undefined);
  assert.ok(waited >= WAIT.open - 50 && waited < WAIT.open + 1000, `${Math.round(waited)}ms`);
});
