// src/app/app-emojis.ts — 앱 이모지 맞추기(가짜 디스코드 API)

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withConfig } from "../helpers/config.ts";
import { iconEntries, icon, useUploaded } from "../../src/ui/icons.ts";
import { imageOf } from "../../src/ui/icon-images.ts";
import { loadKnown, sync, tempName, type Api, type Remote } from "../../src/app/app-emojis.ts";

afterEach(() => useUploaded(new Map()));

/** 메모리의 앱. 그림은 받은 그대로 돌려준다(PNG 처럼). calls: 부른 차례 */
function fakeApp(initial: Array<Remote & { data?: Buffer }> = []) {
  let next = 1000;
  const emojis = new Map<string, Remote & { data?: Buffer }>(initial.map((one) => [one.id, one]));
  const calls: string[] = [];
  const api: Api = {
    list: async () => [...emojis.values()].map(({ data: _data, ...remote }) => remote),
    download: async (remote) => emojis.get(remote.id)?.data ?? null,
    create: async (name, data) => {
      if ([...emojis.values()].some((one) => one.name === name)) throw new Error(`이름 겹침: ${name}`);
      const remote = { id: String(next++), name, animated: false, mine: true };
      emojis.set(remote.id, { ...remote, data });
      calls.push(`create ${name}`);
      return remote;
    },
    rename: async (id, name) => {
      emojis.get(id)!.name = name;
      calls.push(`rename ${name}`);
    },
    remove: async (id) => {
      calls.push(`remove ${emojis.get(id)?.name}`);
      emojis.delete(id);
    },
  };
  return { api, emojis, calls };
}

const total = iconEntries().length;
const names = (app: ReturnType<typeof fakeApp>) => [...app.emojis.values()].map((one) => one.name).sort();

test("처음: 표의 것을 모두 올리고 쓰는 쪽에 싣는다. 다시 그리기를 한 번", async () => {
  const app = fakeApp();
  let redrawn = 0;
  await sync(app.api, { onChanged: async () => void redrawn++ });
  assert.equal(app.emojis.size, total);
  assert.equal(redrawn, 1);
  assert.match(icon("pause"), /^<:pause:\d+>$/);
  assert.deepEqual(
    names(app),
    iconEntries()
      .map((one) => one.name)
      .sort(),
  );
});

test("다시 켬: 그림이 같으면 올리지도 지우지도 다시 그리지도 않는다", async () => {
  const app = fakeApp();
  await sync(app.api, { onChanged: async () => {} });
  app.calls.length = 0;
  let redrawn = 0;
  await sync(app.api, { onChanged: async () => void redrawn++ });
  assert.deepEqual(app.calls, []);
  assert.equal(redrawn, 0);
});

test("운영자 색이 바뀜: 운영자 색 타일만 임시 이름으로 올림 → 다시 그림 → 옛 것 지움 → 이름 되돌림", () =>
  withConfig({ bot: { embedColor: "#2743D2" } }, async () => {
    const app = fakeApp();
    await sync(app.api, { onChanged: async () => {} });
    const before = icon("pause");
    app.calls.length = 0;
    const order: string[] = [];
    await withConfig({ bot: { embedColor: "#FF0000" } }, () =>
      sync(app.api, {
        onChanged: async () => {
          order.push(`redraw(올린 수 ${app.calls.filter((c) => c.startsWith("create")).length}, 지운 수 ${app.calls.filter((c) => c.startsWith("remove")).length})`);
        },
      }),
    );
    const brand = iconEntries().filter((one) => one.tint === "brand" && one.spec.shape !== "white");
    assert.equal(app.calls.filter((c) => c.startsWith("create")).length, brand.length, "운영자 색 타일만 다시 올린다(응답 색 · 흰 기호는 그대로)");
    assert.ok(app.calls.includes("create pause_1"), "이름이 겹쳐 임시 이름으로");
    assert.match(order[0], /지운 수 0/, "옛 것을 지우기 전에 다시 그린다");
    assert.ok(app.calls.indexOf("remove pause") < app.calls.indexOf("rename pause"), "옛 것을 지운 뒤 이름을 되돌린다");
    assert.deepEqual(
      names(app),
      iconEntries()
        .map((one) => one.name)
        .sort(),
      "끝나면 이름이 표와 같다",
    );
    assert.notEqual(icon("pause"), before);
  }));

test("올리는 중에 색이 되돌아감: 멈추고 아무것도 바꾸지 않으며, 다음 맞추기가 올린 것만 지운다", () =>
  withConfig({ bot: { embedColor: "#2743D2" } }, async () => {
    const app = fakeApp();
    await sync(app.api, { onChanged: async () => {} });
    const before = icon("pause");
    app.calls.length = 0;
    let redrawn = 0;
    await withConfig({ bot: { embedColor: "#FF0000" } }, () => sync(app.api, { onChanged: async () => void redrawn++, stale: () => app.calls.length >= 3 }));
    assert.deepEqual(
      app.calls.map((c) => c.split(" ")[0]),
      ["create", "create", "create"],
      "멈춘 뒤로는 올리지도 지우지도 않는다",
    );
    assert.equal(redrawn, 0);
    assert.equal(icon("pause"), before, "쓰는 쪽은 그대로");
    app.calls.length = 0;
    await sync(app.api, { onChanged: async () => void redrawn++ });
    assert.deepEqual(
      app.calls.map((c) => c.split(" ")[0]),
      ["remove", "remove", "remove"],
      "원래 색으로 맞추면 멈추기 전에 올린 임시 이름 것만 지운다",
    );
    assert.equal(redrawn, 0);
    assert.deepEqual(
      names(app),
      iconEntries()
        .map((one) => one.name)
        .sort(),
    );
  }));

test("운영자가 같은 이름으로 올린 이모지는 건드리지 않고 그 아이콘은 유니코드", async () => {
  const theirs = { id: "1", name: "pause", animated: false, mine: false };
  const app = fakeApp([theirs]);
  await sync(app.api, { onChanged: async () => {} });
  assert.ok(app.emojis.has("1"));
  assert.ok(!app.calls.includes("create pause"));
  assert.equal(icon("pause"), "⏸️");
});

test("봇이 올렸는데 쓰지 않는 것(표에서 뺀 것 · 이름 바꾸다 남은 임시 이름)은 지운다", async () => {
  const app = fakeApp([
    { id: "1", name: "old_icon", animated: false, mine: true },
    { id: "2", name: "pause_1", animated: false, mine: true },
  ]);
  await sync(app.api, { onChanged: async () => {} });
  assert.ok(app.calls.includes("remove old_icon"));
  assert.ok(app.calls.includes("remove pause_1"));
});

test("기동 첫머리: 목록만으로 봇이 올린 것의 id 를 싣는다(그림은 보지 않는다), 운영자 것은 싣지 않는다", async () => {
  const app = fakeApp([
    { id: "7", name: "pause", animated: false, mine: true },
    { id: "8", name: "stop", animated: false, mine: false },
  ]);
  assert.equal(await loadKnown(app.api), 1);
  assert.equal(icon("pause"), "<:pause:7>");
  assert.equal(icon("stop"), "⏹️");
});

test("움직이는 것: 디스코드가 다시 인코딩해 바이트가 달라도 같은 그림이면 다시 올리지 않는다", async () => {
  const spin = iconEntries().find((one) => one.spec.shape === "spin")!;
  const image = await imageOf(spin.spec, spin.tint);
  // 디스코드처럼 다시 인코딩(바이트가 달라진다)
  const sharp = (await import("sharp")).default;
  const reencoded = await sharp(image.data, { animated: true }).gif({ effort: 1 }).toBuffer();
  assert.ok(!reencoded.equals(image.data));
  const app = fakeApp();
  await sync(app.api, { onChanged: async () => {} });
  const remote = [...app.emojis.values()].find((one) => one.name === spin.name)!;
  remote.data = reencoded;
  remote.animated = true;
  app.calls.length = 0;
  await sync(app.api, { onChanged: async () => {} });
  assert.deepEqual(app.calls, []);
});

test("임시 이름은 32자 안에서 겹치지 않게", () => {
  assert.equal(tempName("pause", new Set()), "pause_1");
  assert.equal(tempName("pause", new Set(["pause_1"])), "pause_2");
  assert.equal(tempName("x".repeat(32), new Set()).length, 32);
});
