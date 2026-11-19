// src/ui/queue-view.ts: /queue의 보기, 편집 화면(Components V2)과 그 custom_id

import { test } from "node:test";
import assert from "node:assert/strict";
import { textOf } from "../helpers/cv2.ts";
import { IDLE_SESSION } from "../../src/ui/custom-ids.ts";
import { COMPONENTS_BYTES_MAX } from "../../src/ui/message-size.ts";
import { actionOf, gotoOf, pageModal, pageOf, pickOf, queueView, typedPage, type Entry, type QueueInfo } from "../../src/ui/queue-view.ts";

type Node = { type?: number; custom_id?: string; disabled?: boolean; label?: string; components?: Node[]; items?: Array<{ media: { url: string } }>; options?: Array<{ value: string; default?: boolean }> };
const BUTTON = 2;
const SELECT = 3;
const GALLERY = 12;

function nodesOf(view: { toJSON(): unknown }) {
  const out: Node[] = [];
  const walk = (node: Node) => {
    out.push(node);
    for (const child of node.components ?? []) walk(child);
  };
  walk(view.toJSON() as Node);
  return out;
}
const buttonsOf = (view: { toJSON(): unknown }) => nodesOf(view).filter((n) => n.type === BUTTON);
const idsOf = (view: { toJSON(): unknown }) => buttonsOf(view).map((n) => n.custom_id);
const menuOf = (view: { toJSON(): unknown }) => nodesOf(view).find((n) => n.type === SELECT);

const song = (entry: number, over: Partial<Entry> = {}): Entry => Object.defineProperty({ title: `곡${entry}`, pageUrl: `https://y/${entry}`, artist: "가수", duration: 120, requestedBy: { id: "u1" }, ...over }, "entry", { value: entry, enumerable: false }) as Entry;
const info = (count: number, over: Partial<QueueInfo> = {}): QueueInfo => ({
  queue: Array.from({ length: count }, (_, i) => song(100 + i)),
  now: { track: { duration: 300 }, positionSec: 60, paused: false, loop: false, autoplay: false },
  sessionId: "S",
  viewer: { id: "dj", dj: true },
  ...over,
});

test("보기 화면(한 페이지): 제목, 두 줄 목록, 요약 줄, 편집 버튼 하나. 모자이크가 없으면 이미지도 없다", () => {
  const { view, files, page } = queueView(info(3), { mode: "browse", page: 1 }, 0);
  const text = textOf({ components: [view] });
  assert.ok(text.startsWith("### 📋 재생 대기열"), text);
  assert.ok(text.includes("`1` **[곡100](https://y/100)** · 2:00\n-# 가수 · <@u1> · 약 4분 뒤"), text);
  assert.ok(text.includes("`3` **[곡102](https://y/102)**"), text);
  assert.ok(text.includes("-# 총 3곡 · 6분 · <t:600:t>쯤 재생 종료"), text);
  assert.deepEqual([idsOf(view), files, page], [["queue:edit:1"], [], 1]);
  assert.ok(!nodesOf(view).some((n) => n.type === GALLERY));
});

test("보기 화면의 모자이크는 첨부 파일로 단다", () => {
  const mosaic = Buffer.from("webp");
  const { view, files } = queueView(info(3), { mode: "browse", page: 1, mosaic }, 0);
  assert.deepEqual(files, [{ attachment: mosaic, name: "queue.webp" }]);
  assert.equal(nodesOf(view).find((n) => n.type === GALLERY)?.items?.[0].media.url, "attachment://queue.webp");
});

test("보기 화면(여러 페이지): [◀] [페이지/페이지 수] [▶] [편집], 번호는 그 페이지부터. 범위를 넘는 페이지는 끝 페이지로", () => {
  const { view } = queueView(info(25), { mode: "browse", page: 2 }, 0);
  assert.deepEqual(idsOf(view), ["queue:page:1", "queue:goto:browse:2", "queue:page:3", "queue:edit:2"]);
  assert.equal(buttonsOf(view)[1].label, "2/3");
  assert.ok(textOf({ components: [view] }).includes("`11` **[곡110]"));
  const last = queueView(info(25), { mode: "browse", page: 9 }, 0);
  assert.equal(last.page, 3);
  assert.deepEqual(
    buttonsOf(last.view).map((n) => n.disabled ?? false),
    [false, false, true, false],
  );
  assert.deepEqual(
    buttonsOf(queueView(info(25), { mode: "browse", page: 1 }, 0).view).map((n) => n.disabled ?? false),
    [true, false, false, false],
  );
});

test("편집 화면(고르기 전): 같은 목록, 그 페이지 곡의 메뉴(세션을 싣는다), 넘기기 줄의 끝은 완료. 곡 버튼 줄은 없다", () => {
  const { view, files } = queueView(info(25), { mode: "edit", page: 2 }, 0);
  const text = textOf({ components: [view] });
  assert.ok(text.startsWith("### ✏️ 대기열 편집"), text);
  const menu = menuOf(view);
  assert.equal(menu?.custom_id, "queue:pick:2:S");
  assert.deepEqual(
    menu?.options?.map((o) => o.value),
    Array.from({ length: 10 }, (_, i) => `entry:${110 + i}`),
  );
  assert.deepEqual(idsOf(view), ["queue:edit:1", "queue:goto:edit:2", "queue:edit:3", "queue:page:2"]);
  assert.deepEqual(files, []);
});

test("편집 화면(고른 뒤): 곡 버튼 줄(대기열 ID, 페이지, 세션). 맨 앞 곡은 다음에 재생, 위로가, 맨 끝 곡은 아래로가 꺼진다", () => {
  const first = queueView(info(12), { mode: "edit", page: 1, picked: 100 }, 0).view;
  assert.deepEqual(idsOf(first).slice(0, 5), ["queue:do:play:100:1:S", "queue:do:next:100:1:S", "queue:do:up:100:1:S", "queue:do:down:100:1:S", "queue:do:remove:100:1:S"]);
  assert.deepEqual(
    buttonsOf(first)
      .slice(0, 5)
      .map((n) => n.disabled ?? false),
    [false, true, true, false, false],
  );
  assert.equal(menuOf(first)?.options?.find((o) => o.default)?.value, "entry:100");
  const last = queueView(info(12), { mode: "edit", page: 2, picked: 111 }, 0).view;
  assert.deepEqual(
    buttonsOf(last)
      .slice(0, 5)
      .map((n) => n.disabled ?? false),
    [false, false, false, true, false],
  );
});

test("편집 화면: 고른 곡이 그 페이지에 없으면 곡 버튼 줄이 없다. 세션이 없으면 끝난 패널의 표시", () => {
  const { view } = queueView(info(12, { sessionId: null }), { mode: "edit", page: 1, picked: 111 }, 0);
  assert.equal(menuOf(view)?.custom_id, `queue:pick:1:${IDLE_SESSION}`);
  assert.ok(!idsOf(view).some((id) => id?.startsWith("queue:do:")));
});

test("시작까지와 끝나는 시각은 셀 수 있을 때만: 멈춰 있으면 둘 다 없다", () => {
  const text = textOf({ components: [queueView(info(2, { now: { track: { duration: 300 }, positionSec: 0, paused: true, loop: false, autoplay: false } }), { mode: "browse", page: 1 }, 0).view] });
  assert.ok(!text.includes("뒤") && !text.includes("재생 종료"), text);
  assert.ok(text.includes("-# 총 2곡 · 4분"), text);
});

test("가장 긴 페이지도 글 4000자, 부품 40개, 부품 크기 상한 안: 긴 주소, 긴 제목(한글은 3바이트), 이스케이프할 글자, 긴 아티스트, 세 자리 번호", () => {
  const marks = (entry: number) => song(entry, { title: "*_~`|".repeat(40), artist: "[a](b)".repeat(30), pageUrl: `https://y/${"%EA%B0%80".repeat(200)}${entry}` });
  const korean = (entry: number) => song(entry, { title: "가나다라마바사아자차".repeat(12), artist: "하늘과바다".repeat(20), pageUrl: `https://y/${"가".repeat(300)}${entry}`, requestedBy: { id: "123456789012345678" } });
  for (const long of [marks, korean]) {
    const many: QueueInfo = { ...info(0), queue: Array.from({ length: 1000 }, (_, i) => long(i + 1)) };
    for (const screen of [
      { mode: "browse", page: 100, mosaic: Buffer.from("x") },
      { mode: "edit", page: 100, picked: 995 },
    ] as const) {
      const { view } = queueView(many, screen, 0);
      const text = textOf({ components: [view] });
      const bytes = Buffer.byteLength(JSON.stringify(view.toJSON()));
      assert.ok(text.length <= 4000, `${screen.mode}: ${text.length}자`);
      assert.ok(nodesOf(view).length <= 40, `${screen.mode}: 부품 ${nodesOf(view).length}개`);
      assert.ok(bytes <= COMPONENTS_BYTES_MAX, `${screen.mode}: ${bytes}바이트`);
      assert.equal(text.split("\n").filter((line) => /^`\d+`/.test(line)).length, 10, `${screen.mode}: 열 곡이 다 보인다`);
    }
  }
});

test("자동재생 중에는 끝나는 시각이 없다(곡이 이어진다). 시작까지는 그대로", () => {
  const text = textOf({ components: [queueView(info(2, { now: { track: { duration: 300 }, positionSec: 60, paused: false, loop: false, autoplay: true } }), { mode: "browse", page: 1 }, 0).view] });
  assert.ok(!text.includes("재생 종료") && text.includes("약 4분 뒤"), text);
});

test("DJ 가 아니면: 편집할 곡(자기가 넣은 곡)이 없으면 편집 버튼이 없고, 있으면 메뉴에 그 곡만(번호는 대기열 자리), 버튼은 삭제만", () => {
  const listener = { id: "u2", dj: false };
  const none = queueView(info(3, { viewer: listener }), { mode: "browse", page: 1 }, 0).view;
  assert.deepEqual(idsOf(none), [], "한 페이지면 넘기기 줄도 없다");
  assert.deepEqual(idsOf(queueView(info(25, { viewer: listener }), { mode: "browse", page: 1 }, 0).view), ["queue:page:0", "queue:goto:browse:1", "queue:page:2"]);

  const queue = [song(100), song(101, { requestedBy: { id: "u2" } }), song(102)];
  const mine = info(0, { queue, viewer: listener });
  assert.ok(idsOf(queueView(mine, { mode: "browse", page: 1 }, 0).view).includes("queue:edit:1"));
  const menu = menuOf(queueView(mine, { mode: "edit", page: 1 }, 0).view);
  assert.deepEqual(
    menu?.options?.map((o) => [o.value, (o as { label?: string }).label]),
    [["entry:101", "2. 곡101"]],
  );
  assert.deepEqual(idsOf(queueView(mine, { mode: "edit", page: 1, picked: 101 }, 0).view), ["queue:do:remove:101:1:S", "queue:page:1"]);
  assert.deepEqual(idsOf(queueView(mine, { mode: "edit", page: 1, picked: 100 }, 0).view), ["queue:page:1"], "남의 곡은 버튼이 없다");
});

test("custom_id 읽기: 알아볼 수 없는 것은 null", () => {
  assert.equal(pageOf("queue:page:3"), 3);
  assert.equal(pageOf("queue:page:x"), null);
  assert.deepEqual(pickOf("queue:pick:2:S"), { page: 2, session: "S" });
  assert.equal(pickOf("queue:pick:2"), null);
  assert.deepEqual(actionOf("queue:do:up:105:1:S"), { action: "up", entry: 105, page: 1, session: "S" });
  assert.equal(actionOf("queue:do:up:-1:1:S"), null);
  assert.deepEqual(gotoOf("queue:goto:edit:4"), { mode: "edit", page: 4 });
  assert.equal(gotoOf("queue:goto:other:4"), null);
  assert.deepEqual(["7", " 12 ", "", "a", "1.5", "-3"].map(typedPage), [7, 12, null, null, null, null]);
});

test("페이지 이동 모달: 연 버튼과 같은 custom_id, 자리표시는 범위", () => {
  const modal = pageModal("browse", 2, 12).toJSON() as { custom_id: string; title: string; components: Array<{ components: Array<{ custom_id: string; placeholder?: string; max_length?: number }> }> };
  assert.equal(modal.custom_id, "queue:goto:browse:2");
  assert.deepEqual(modal.components[0].components[0], { ...modal.components[0].components[0], custom_id: "page", placeholder: "1~12", max_length: 2 });
});
