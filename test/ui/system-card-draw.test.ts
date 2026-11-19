// src/ui/system-card: /system 이미지 둘을 그린다(draw), 워커에서 그린다(render)

import { test } from "node:test";
import assert from "node:assert/strict";
import { BOTTOM, TOP, drawSystemCards, type CardData } from "../../src/ui/system-card/draw.ts";
import { _running, renderSystemCards } from "../../src/ui/card-render/render.ts";

const GB = 1024 ** 3;
const series = (n: number, v: number, max: number) => ({ values: Array.from({ length: n }, (_, i) => v + (i % 5)), max });

function sample(over: Partial<CardData> = {}, points = 60): CardData {
  return {
    seed: "#7289da",
    overall: { level: "ok", count: 0 },
    recent: { warn: 2, error: 0 },
    cpu: { bot: 3.4, system: 21, cores: 20, model: "12th Gen Intel Core i7-12700F", level: "ok" },
    heap: { used: 0.05 * GB, limit: 4.2 * GB, rss: 0.2 * GB, percent: 1, level: "ok" },
    cache: { bytes: 3.2 * GB, maxBytes: 10 * GB },
    disk: { drive: "F:", usedBytes: 727 * GB, totalBytes: 969 * GB, level: "ok" },
    uptime: { bot: 47_400, os: 332_000 },
    overview: { guilds: 3, playing: 2, users: 46 },
    history: {
      minutes: 15,
      cpuBot: series(points, 3, 100),
      cpuSystem: series(points, 20, 100),
      loop: { ...series(points, 3, 100), now: 8.1, level: "ok" },
      encoding: { ...series(points, 6, 40), now: 1.9, level: "ok" },
    },
    ...over,
  };
}

/** PNG 머리(IHDR)의 가로, 세로 */
function sizeOf(png: Buffer) {
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("이미지 둘은 지정된 크기의 PNG", async () => {
  const { top, bottom } = await drawSystemCards(sample());
  assert.deepEqual(sizeOf(top), { width: TOP.width, height: TOP.height });
  assert.deepEqual(sizeOf(bottom), { width: BOTTOM.width, height: BOTTOM.height });
});

test("긴 제목, 긴 CPU 모델과 드라이브 이름, 큰 수, 주의와 위험 단계, 빈 기록, 잘못된 바탕색도 그린다", async () => {
  const cases: CardData[] = [
    sample({ overall: { level: "warn", count: 12 }, cpu: { bot: 95, system: 100, cores: 128, model: "AMD Ryzen Threadripper PRO 7995WX 96-Cores ".repeat(3), level: "bad" } }),
    sample({ overall: { level: "bad", count: 3 }, disk: { drive: "/mnt/storage/very-long-mount-point", usedBytes: 968 * GB, totalBytes: 969 * GB, level: "bad" }, overview: { guilds: 12_345, playing: 1_000, users: 9_876_543 } }),
    sample({ seed: "not-a-color", cache: { bytes: 0, maxBytes: 0 }, disk: { drive: "", usedBytes: 0, totalBytes: 0, level: "ok" } }, 0),
    sample({ seed: null }, 1),
  ];
  for (const one of cases) {
    const { top, bottom } = await drawSystemCards(one);
    assert.equal(sizeOf(top).width, TOP.width);
    assert.equal(sizeOf(bottom).width, BOTTOM.width);
  }
});

test("워커에서 그린 결과도 같은 크기의 PNG", async () => {
  const { top, bottom } = await renderSystemCards(sample());
  assert.deepEqual(sizeOf(top), { width: TOP.width, height: TOP.height });
  assert.deepEqual(sizeOf(bottom), { width: BOTTOM.width, height: BOTTOM.height });
});

test("상한을 넘기면 실패 처리하고, 다음 그리기는 새 워커에서 실행된다", async () => {
  await assert.rejects(renderSystemCards(sample(), { timeoutMs: 1 }), /시간 초과/);
  const { top } = await renderSystemCards(sample());
  assert.equal(sizeOf(top).width, TOP.width);
});

test("마지막 그리기 뒤 쉬면 워커가 끝나고, 다음 그리기는 새 워커에서 실행된다", async () => {
  await renderSystemCards(sample(), { idleMs: 50 });
  assert.equal(_running(), true, "그린 직후에는 떠 있다");
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(_running(), false, "쉬는 시간이 지나면 끝낸다");
  const { top } = await renderSystemCards(sample(), { idleMs: 50 });
  assert.equal(sizeOf(top).width, TOP.width);
});
