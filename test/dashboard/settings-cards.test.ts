// src/dashboard/settings-cards.ts: 서버 설정 카드마다 누가 보고 고치는가. 카드의 조건(계층, 봇 추방), 보이는 카드, 막힌 필드가 하나라도 있으면 거절, 카드가 없을 때의 거절

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, shownCards, editsAny, noCardRefusal, noBodyCardRefusal, cardRefusal, fieldRefusal, type CardTable, type Viewer } from "../../src/dashboard/settings-cards.ts";
import { useDefaultDocuments, useDocument } from "../helpers/config-docs.ts";
import { settingsBody } from "../../src/dashboard/request-schemas.ts";

// 보는 사람: 계층과 봇을 추방할 수 있는지
const as = (tier: Viewer["tier"], kicksBot = false): Viewer => ({ tier, kicksBot });
const MANAGER = as("server-manager");
const DJ = as("dj");
const USER = as("user");

test("지금 카드의 조건: 상주 모드는 DJ(/247 과 같다), 봇 내보내기는 봇을 추방할 수 있는 사람, 나머지는 서버 관리자", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CARDS).map(([card, rule]) => [card, rule.gate])), { stay: "dj", channel: "server-manager", dj: "server-manager", sponsorblock: "server-manager", playlistAdd: "server-manager", agePlace: "server-manager", leave: "kick-bot" });
  assert.deepEqual(shownCards(DJ), ["stay"]);
  assert.deepEqual(shownCards(USER), []);
  assert.equal(noCardRefusal(), "must-dj");
  assert.equal(cardRefusal("stay"), "must-dj");
  assert.equal(cardRefusal("leave"), "cannot-kick-bot");
});

test("봇 내보내기는 계층과 따로 본다: 서버 관리자라도 추방할 수 없으면 없고, 일반 사용자라도 추방할 수 있으면 그 카드 하나", () => {
  assert.ok(!shownCards(MANAGER).includes("leave"));
  assert.deepEqual(shownCards(as("user", true)), ["leave"]);
  assert.ok(shownCards(as("server-manager", true)).includes("leave"));
  assert.equal(editsAny(as("user", true)), false, "봇 내보내기는 저장 본문(PUT)으로 고치지 않는다");
});

test("상주 모드, 봇 내보내기는 저장 본문(PUT)으로 고치지 않는다: DJ 는 PUT 으로 고칠 카드가 없고, 그 거절은 서버 관리자", () => {
  assert.deepEqual([CARDS.stay.fields, CARDS.leave.fields], [[], []]);
  assert.equal(editsAny(DJ), false);
  assert.equal(editsAny(MANAGER), true);
  assert.equal(noBodyCardRefusal(), "must-server-manager");
});

test("연령 제한 카드는 운영자가 켰을 때만 보인다(고치는 것은 막지 않는다)", () => {
  try {
    useDocument("age-content", { enabled: false, changedAt: 1 });
    assert.deepEqual(shownCards(MANAGER), ["stay", "channel", "dj", "sponsorblock", "playlistAdd"]);
    assert.equal(fieldRefusal(MANAGER, { agePlace: "all" }), null);
    useDocument("age-content", { enabled: true, changedAt: 2 });
    assert.ok(shownCards(MANAGER).includes("agePlace"));
  } finally {
    useDefaultDocuments();
  }
});

test("저장 본문의 필드는 모두 어느 한 카드에 속한다(속하지 않은 필드는 권한 확인 없이 지나간다)", () => {
  const claimed = Object.values(CARDS).flatMap((rule) => rule.fields);
  assert.deepEqual([...claimed].sort(), Object.keys(settingsBody({ min: 1, max: 10 }).shape).sort());
  assert.equal(new Set(claimed).size, claimed.length, "한 필드는 한 카드에만");
});

// 저장 본문 필드가 있는 DJ 카드가 생겼을 때의 판정. 지금 표에는 없어 시험용 표로 본다
const WITH_DJ: CardTable = { ...CARDS, playlistAdd: { gate: "dj", fields: ["playlistAddMax"] } };

test("DJ 카드가 있으면: DJ 는 그 카드의 필드만 고친다. 다른 카드의 필드가 하나라도 있으면 서버 관리자 거절", () => {
  assert.deepEqual(shownCards(DJ, WITH_DJ), ["stay", "playlistAdd"]);
  assert.equal(fieldRefusal(DJ, { playlistAddMax: 50 }, WITH_DJ), null);
  assert.equal(fieldRefusal(DJ, { playlistAddMax: 50, djRoleIds: ["r1"] }, WITH_DJ), "must-server-manager");
  assert.equal(fieldRefusal(DJ, { botChannelId: null }, WITH_DJ), "must-server-manager", "해제(null)도 고치는 것이다");
  assert.equal(fieldRefusal(MANAGER, { playlistAddMax: 50, djRoleIds: ["r1"] }, WITH_DJ), null);
  assert.equal(editsAny(DJ, WITH_DJ), true);
});

test("일반 사용자: 카드도 없고 고칠 것도 없다. 거절은 가장 낮은 카드 계층의 것", () => {
  assert.deepEqual(shownCards(USER, WITH_DJ), []);
  assert.equal(editsAny(USER, WITH_DJ), false);
  assert.equal(fieldRefusal(USER, { playlistAddMax: 50 }, WITH_DJ), "must-dj");
  assert.equal(noCardRefusal(WITH_DJ), "must-dj");
  assert.equal(editsAny(USER), false);
});
