// src/infra/available-memory.ts: 쓸 수 있는 메모리. macOS 는 vm_stat 의 free + inactive(os.freemem 은 캐시로 쥔 페이지가 빠져 작다), 그 밖은 os.freemem
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { availableMemory, parseVmStat, _resetCache } from "../../src/infra/available-memory.ts";

beforeEach(() => _resetCache());

// macOS 26(arm64)의 vm_stat 출력 모양
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12000.
Pages active:                            150000.
Pages inactive:                          140000.
Pages speculative:                         3000.
Pages throttled:                              0.
Pages wired down:                         90000.
Pages purgeable:                           5000.
"Translation faults":                 900000000.
`;

test("vm_stat: free + inactive 페이지에 페이지 크기를 곱한다(purgeable, speculative 는 더하지 않는다)", () => {
  assert.equal(parseVmStat(VM_STAT), (12000 + 140000) * 16384);
  assert.equal(parseVmStat("다른 출력"), null);
  assert.equal(parseVmStat(VM_STAT.replace(/^Pages inactive:.*$/m, "")), null);
});

test("macOS 가 아니면 os.freemem 을 그대로 쓰고 vm_stat 을 부르지 않는다", () => {
  let measured = 0;
  const bytes = availableMemory({ platform: "linux", measure: () => (measured++, 1) });
  assert.equal(typeof bytes, "number");
  assert.equal(measured, 0);
});

test("macOS: vm_stat 값을 쓰고 2초 동안 다시 재지 않는다. 재지 못하면 os.freemem 으로 물러선다", () => {
  let measured = 0;
  const measure = () => (measured++, 6 * 1024 ** 3);
  assert.equal(availableMemory({ platform: "darwin", measure, now: 1_000 }), 6 * 1024 ** 3);
  assert.equal(availableMemory({ platform: "darwin", measure, now: 2_999 }), 6 * 1024 ** 3);
  assert.equal(measured, 1);
  availableMemory({ platform: "darwin", measure, now: 3_000 });
  assert.equal(measured, 2);
  _resetCache();
  const fallback = availableMemory({ platform: "darwin", measure: () => null, now: 10_000 });
  assert.ok(Math.abs(fallback - os.freemem()) < 512 * 1024 ** 2, "os.freemem 과 같은 값(재는 사이 조금 달라질 수 있다)");
});
