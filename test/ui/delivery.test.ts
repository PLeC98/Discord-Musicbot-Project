// src/ui/delivery.ts — 응답의 대상과 수명. 본인 응답 · 후속 메시지 · 공개 응답 · 채널 메시지가 같은 수명표로 지워진다

import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type RepliableInteraction } from "discord.js";
import { LIFETIME, TOKEN_MS, noticeMs, toSelf, replaceSelf, noticeSelf, noticeInstead, toAll, selfOnly, lifetimesOf } from "../../src/ui/delivery.ts";
import { frame } from "../../src/ui/frame.ts";
import { notice } from "../../src/ui/text/ko/errors.ts";
import { noticeOf } from "../../src/ui/text/notice.ts";
import { fake } from "../helpers/fake.ts";

type Over = { replied?: boolean; deferred?: boolean; command?: boolean; component?: boolean; channel?: boolean; denied?: boolean };

// 부른 순서를 적는 상호작용. 보낸 것은 flags 로 본인 · 모두를 구분한다
function asked({ replied = false, deferred = false, command = true, component = false, channel = true, denied = false }: Over = {}) {
  const calls: string[] = [];
  const visible = (p: { flags?: unknown }) => ([p.flags].flat().includes(MessageFlags.Ephemeral) ? "self" : "all");
  const it = {
    replied,
    deferred,
    isChatInputCommand: () => command,
    isMessageComponent: () => component,
    reply: async (p: { flags?: unknown }) => {
      calls.push(`reply:${visible(p)}`);
      it.replied = true;
      return { resource: { message: { id: "R" } } };
    },
    followUp: async (p: { flags?: unknown }) => (calls.push(`followUp:${visible(p)}`), { id: "F" }),
    editReply: async () => calls.push("editReply"),
    deferUpdate: async () => ((it.deferred = true), calls.push("deferUpdate")),
    deleteReply: async (id?: string) => calls.push(id ? `delete:${id}` : "delete"),
    channel: channel
      ? {
          send: async () => {
            calls.push("send");
            if (denied) throw new Error("Missing Permissions");
            return { id: "C", delete: async () => calls.push("delete:C") };
          },
        }
      : null,
  };
  return { it, calls, real: fake<RepliableInteraction>(it) };
}

const view = () => frame({ title: "결과" });

test("수명: 경고 10초 · 오류 15초, 연결 오류는 10초 · 곡 전환 실패는 15초", () => {
  assert.equal(noticeMs(notice("must-dj")), 10_000);
  assert.equal(noticeMs(notice("command-failed")), 15_000);
  assert.equal(noticeMs(notice("network-error")), 10_000, "오류 수준이지만 대개 일시적");
  assert.equal(noticeMs(notice("switch-failed")), 15_000, "경고 수준이지만 운영자에게 알려 달라고 한다");
  assert.equal(noticeMs(noticeOf("error", "failed", "코드 없는 오류")), 15_000);
  assert.equal(noticeMs(noticeOf("warning", "autoplay", "코드 없는 경고")), 10_000);
});

test("본인: 아직 답하지 않았으면 응답, 답했으면 후속 메시지. 수명이 지나면 그것을 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = asked();
  await toSelf(first.real, selfOnly({ content: "x" }), 10_000);
  t.mock.timers.tick(9_999);
  assert.deepEqual(first.calls, ["reply:self"]);
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(first.calls, ["reply:self", "delete"]);

  const later = asked({ replied: true });
  await toSelf(later.real, selfOnly({ content: "x" }), 10_000);
  t.mock.timers.tick(10_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(later.calls, ["followUp:self", "delete:F"]);
});

test("본인: 지우지 않는 수명(null)과 토큰보다 긴 수명은 예약하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ms of [null, TOKEN_MS]) {
    const a = asked();
    await toSelf(a.real, selfOnly({ content: "x" }), ms);
    t.mock.timers.tick(TOKEN_MS * 2);
    await Promise.resolve();
    assert.deepEqual(a.calls, ["reply:self"]);
    assert.deepEqual(lifetimesOf(a.it), [ms]);
  }
  assert.ok(LIFETIME.screen < TOKEN_MS, "읽는 화면도 토큰이 살아 있을 때 지운다");
});

test("안내: 미뤄 둔 명령은 자리표시자를 지우고 후속 메시지로, 그 후속 메시지를 수준대로 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = asked({ deferred: true });
  await noticeSelf(a.real, notice("command-failed"));
  assert.deepEqual(a.calls, ["delete", "followUp:self"]);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(a.calls, ["delete", "followUp:self", "delete:F"]);

  const b = asked();
  await noticeSelf(b.real, notice("must-dj"));
  assert.deepEqual(b.calls, ["reply:self"]);
  assert.deepEqual(lifetimesOf(b.it), [10_000]);
});

test("안내로 교체: 아직 답하지 않은 버튼은 먼저 받아 버튼이 달린 메시지를 지운다", async () => {
  const a = asked({ command: false, component: true });
  await noticeInstead(a.real, notice("queue-empty"));
  assert.deepEqual(a.calls, ["deferUpdate", "delete", "followUp:self"]);
  assert.deepEqual(lifetimesOf(a.it), [10_000]);
});

test("자리표시자 고치기: 고친 뒤 수명이 지나면 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = asked({ replied: true });
  await replaceSelf(a.real, view(), 15_000);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(a.calls, ["editReply", "delete"]);
});

test("모두: 아직 답하지 않았으면 공개 응답으로 보내고 수명이 지나면 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = asked();
  await toAll(a.real, view(), 15_000);
  assert.deepEqual(a.calls, ["reply:all"]);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(a.calls, ["reply:all", "delete"]);
});

test("모두: 본인 자리표시자를 표시했으면 지우고 채널에 새로, 채널에 쓸 수 없으면 공개 후속 메시지", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = asked({ replied: true });
  await toAll(a.real, view(), 15_000);
  assert.deepEqual(a.calls, ["delete", "send"]);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(a.calls, ["delete", "send", "delete:C"]);

  const b = asked({ replied: true, channel: false });
  await toAll(b.real, view(), 15_000);
  assert.deepEqual(b.calls, ["delete", "followUp:all"]);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(b.calls, ["delete", "followUp:all", "delete:F"]);
});

test("모두: 채널에 쓸 권한이 없으면 공개 후속 메시지로 보낸다(상호작용 응답은 채널 권한이 없어도 된다)", async () => {
  const a = asked({ replied: true, denied: true });
  await toAll(a.real, view(), 15_000);
  assert.deepEqual(a.calls, ["delete", "send", "followUp:all"]);
});

test("모두: 지우지 않는 수명(null)이면 남긴다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = asked();
  await toAll(a.real, view(), null);
  t.mock.timers.tick(TOKEN_MS);
  await Promise.resolve();
  assert.deepEqual(a.calls, ["reply:all"]);
  assert.deepEqual(lifetimesOf(a.it), [null]);
});
