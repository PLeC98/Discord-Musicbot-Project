// src/app/settings-nudge.ts: 서버 설정이 바뀌면 대시보드에 알린다. 볼륨만 바뀐 것은 알리지 않는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import { nudgeOnSettingsChange } from "../../src/app/settings-nudge.ts";

const store = openTempStore("settings-nudge-");
after(() => store.close());
const guildSettings = await import("../../src/store/guild-settings.ts");

test("디스코드 쪽 쓰기, 초기화는 넛지를 내고 볼륨 저장만은 내지 않는다", async () => {
  const touched: string[] = [];
  const off = nudgeOnSettingsChange(guildSettings.onChanged, (guildId) => touched.push(guildId));
  try {
    await guildSettings.saveVolume("g1", 30);
    assert.deepEqual(touched, []);
    await guildSettings.setDjRoles("g1", ["r1"]);
    await guildSettings.setNormalize("g2", true);
    await guildSettings.setNormalize("g2", true); // 바뀐 것이 없다
    assert.deepEqual(touched, ["g1", "g2"]);
    guildSettings.removeAll();
    assert.deepEqual(touched.slice(2).sort(), ["g1", "g2"]);
  } finally {
    off();
  }
});
