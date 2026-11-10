// dashboard/src/composables/load-generations.ts: 새로고침 세대를 관리한다. 새 세대를 열면 이전 세대를 취소하고, 늦게 끝난 이전 세대가 새 세대를 건드리지 않는다.
// 같은 블록은 진행 중인 요청을 함께 기다리고, 리비전이 다른 블록은 반영하지 않는다. 모두 불러오기는 시작한 세대의 블록이 같은 리비전으로 다 와야 true. 화면을 떠나면 늦게 온 응답을 반영하지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoadGenerations } from "../../../dashboard/src/composables/load-generations.ts";

type Page = { revision: number; block: number };

// 응답을 테스트가 정할 때까지 늦추는 요청
function deferred() {
  const asked: Array<{ block: number; signal: AbortSignal; answer: (page: Page) => void; fail: (error: Error) => void }> = [];
  const fetchOf = (block: number) => (signal: AbortSignal) =>
    new Promise<Page>((resolve, reject) => {
      asked.push({ block, signal, answer: resolve, fail: reject });
    });
  return { asked, fetchOf };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("새 세대를 열면 이전 세대의 요청을 끊고, 늦게 온 이전 세대의 응답은 반영하지 않는다(gone)", async () => {
  const gens = createLoadGenerations();
  const { asked, fetchOf } = deferred();
  const applied: number[] = [];
  const first = gens.begin();
  const old = gens.load(0, fetchOf(0), (page) => void applied.push(page.revision));
  gens.begin();
  assert.equal(asked[0].signal.aborted, true, "앞 세대의 요청을 끊는다");
  assert.equal(gens.isCurrent(first), false);
  asked[0].answer({ revision: 1, block: 0 });
  assert.equal(await old, "gone");
  assert.equal(applied.length, 0);

  const fresh = gens.load(0, fetchOf(0), (page) => void applied.push(page.revision));
  assert.equal(asked.length, 2, "새 세대는 같은 블록을 다시 불러온다");
  asked[1].answer({ revision: 2, block: 0 });
  assert.equal(await fresh, "ok");
  assert.deepEqual(applied, [2]);
  assert.equal(gens.revision, 2);
});

test("같은 세대의 같은 블록은 한 번만 요청하고 진행 중인 요청을 함께 기다린다. 끝나면 다시 불러올 수 있다", async () => {
  const gens = createLoadGenerations();
  gens.begin();
  const { asked, fetchOf } = deferred();
  const a = gens.load(3, fetchOf(3), () => {});
  const b = gens.load(3, fetchOf(3), () => {});
  assert.equal(asked.length, 1);
  asked[0].answer({ revision: 7, block: 3 });
  assert.deepEqual(await Promise.all([a, b]), ["ok", "ok"]);
  void gens.load(3, fetchOf(3), () => {});
  assert.equal(asked.length, 2);
});

test("세대의 리비전은 처음 반영한 블록의 것이다. 리비전이 다른 블록은 반영하지 않는다(changed)", async () => {
  const gens = createLoadGenerations();
  gens.begin();
  const { asked, fetchOf } = deferred();
  const applied: number[] = [];
  const apply = (page: Page) => void applied.push(page.block);
  const zero = gens.load(0, fetchOf(0), apply);
  const one = gens.load(1, fetchOf(1), apply);
  asked[0].answer({ revision: 5, block: 0 });
  asked[1].answer({ revision: 6, block: 1 });
  assert.deepEqual(await Promise.all([zero, one]), ["ok", "changed"]);
  assert.deepEqual(applied, [0]);
  assert.equal(gens.revision, 5, "뒤에 불러온 블록이 덮지 않는다");
});

test("모두 불러오기: 불러오는 중인 블록까지 기다려 시작한 세대의 블록이 다 오면 true. 그사이 새로고침했거나, 리비전이 다르거나, 실패하면 false", { timeout: 5000 }, async () => {
  const gens = createLoadGenerations();
  gens.begin();
  const { asked, fetchOf } = deferred();
  const loaded = new Set<number>([1]);
  const loadOne = (block: number) => gens.load(block, fetchOf(block), () => void loaded.add(block));
  // 보이는 구간이 블록 0 을 이미 불러오는 중이다
  const visible = loadOne(0);
  const all = gens.loadAll(3, (block) => loaded.has(block), loadOne);
  await tick();
  assert.deepEqual(
    asked.map((one) => one.block),
    [0],
    "진행 중인 블록 0 을 함께 기다리고, 이미 불러온 블록 1 은 건너뛴다",
  );
  asked[0].answer({ revision: 1, block: 0 });
  await tick();
  asked[1].answer({ revision: 1, block: 2 });
  assert.equal(await all, true);
  assert.equal(await visible, "ok");

  // 새로고침이 겹쳤다
  const again = createLoadGenerations();
  again.begin();
  const late = deferred();
  const overlapped = again.loadAll(
    2,
    () => false,
    (block) => again.load(block, late.fetchOf(block), () => {}),
  );
  await tick();
  again.begin();
  late.asked[0].answer({ revision: 1, block: 0 });
  assert.equal(await overlapped, false);

  // 블록을 불러오는 사이에 데이터가 바뀌었다
  const changed = createLoadGenerations();
  changed.begin();
  const moved = deferred();
  const differs = changed.loadAll(
    2,
    () => false,
    (block) => changed.load(block, moved.fetchOf(block), () => {}),
  );
  await tick();
  moved.asked[0].answer({ revision: 1, block: 0 });
  await tick();
  moved.asked[1].answer({ revision: 2, block: 1 });
  assert.equal(await differs, false);

  // 블록 하나를 불러오지 못했다
  const broken = createLoadGenerations();
  broken.begin();
  const failing = deferred();
  const fails = broken.loadAll(
    2,
    () => false,
    (block) => broken.load(block, failing.fetchOf(block), () => {}),
  );
  await tick();
  failing.asked[0].fail(new Error("요청 실패"));
  assert.equal(await fails, false);
  assert.equal(failing.asked.length, 1, "실패한 뒤로는 더 불러오지 않는다");
});

test("화면을 떠나면(dispose) 진행 중인 요청을 끊고 늦게 온 응답은 반영하지 않는다. 그 뒤의 요청은 보내지 않는다", async () => {
  const gens = createLoadGenerations();
  gens.begin();
  const { asked, fetchOf } = deferred();
  const applied: number[] = [];
  const running = gens.load(0, fetchOf(0), (page) => void applied.push(page.block));
  gens.dispose();
  assert.equal(asked[0].signal.aborted, true);
  asked[0].answer({ revision: 1, block: 0 });
  assert.equal(await running, "gone");
  assert.equal(await gens.load(1, fetchOf(1), () => {}), "gone");
  assert.deepEqual([applied, asked.length], [[], 1]);
});
