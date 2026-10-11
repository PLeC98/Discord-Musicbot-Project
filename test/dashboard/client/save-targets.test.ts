// dashboard/src/composables/save-targets.ts — 운영자 패널의 저장 막대 하나가 고친 편집기를 탭 차례로 저장 · 되돌린다

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSaveTarget, revertAll, saveAll, saveTargets } from "../../../dashboard/src/composables/save-targets.ts";

// 편집기의 ref 흉내(목록은 .value 만 읽는다). vue 는 화면 쪽 패키지라 시험에서 부르지 않는다
const flag = (value: boolean) => ({ value }) as never;

/** 가짜 편집기. 저장 · 되돌리기를 log 에 적는다 */
function editor(tab: string, log: string[], { dirty = true, ok = true } = {}) {
  return addSaveTarget({
    tab,
    dirty: flag(dirty),
    saving: flag(false),
    save: async (restarting) => {
      log.push(`save ${tab}${restarting ? " restarting" : ""}`);
      return ok;
    },
    revert: () => log.push(`revert ${tab}`),
  });
}

const ORDER = ["settings", "youtube", "presence", "autoplay", "ai"];

test("고친 편집기만 탭 차례로 저장한다(올린 차례와 무관). 다시 시작이면 그렇게 알린다", async () => {
  const log: string[] = [];
  const off = [editor("ai", log), editor("settings", log), editor("presence", log, { dirty: false }), editor("youtube", log)];
  assert.equal(await saveAll(ORDER, true), null);
  assert.deepEqual(log, ["save settings restarting", "save youtube restarting", "save ai restarting"]);
  for (const one of off) one();
});

test("하나가 실패하면 거기서 멈추고 그 편집기를 돌려준다", async () => {
  const log: string[] = [];
  const off = [editor("settings", log), editor("autoplay", log, { ok: false }), editor("ai", log)];
  const failed = await saveAll(ORDER);
  assert.equal(failed?.tab, "autoplay");
  assert.deepEqual(log, ["save settings", "save autoplay"]);
  for (const one of off) one();
});

test("되돌리기는 고친 편집기 모두. 내리면 목록에서 빠진다", () => {
  const log: string[] = [];
  const off = [editor("settings", log), editor("ai", log, { dirty: false }), editor("youtube", log)];
  revertAll();
  assert.deepEqual(log.sort(), ["revert settings", "revert youtube"]);
  for (const one of off) one();
  assert.equal(saveTargets.size, 0);
});
