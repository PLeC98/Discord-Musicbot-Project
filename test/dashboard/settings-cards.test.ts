// src/dashboard/settings-cards.ts: 서버 설정 카드마다 누가 보고 고치는가. 지금 카드의 계층, 보이는 카드, 막힌 필드가 하나라도 있으면 거절, 카드가 없을 때의 거절

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, shownCards, editsAny, noCardRefusal, fieldRefusal, type CardTable } from "../../src/dashboard/settings-cards.ts";
import { useDefaultDocuments, useDocument } from "../helpers/config-docs.ts";
import { settingsBody } from "../../src/dashboard/request-schemas.ts";

test("지금 카드는 모두 서버 관리자 전용이다(계층을 낮추면 화면, 저장, 설정 버튼이 함께 바뀐다)", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CARDS).map(([card, rule]) => [card, rule.tier])), { channel: "server-manager", dj: "server-manager", sponsorblock: "server-manager", playlistAdd: "server-manager", agePlace: "server-manager" });
  assert.deepEqual(shownCards("dj"), []);
  assert.deepEqual(shownCards("user"), []);
  assert.equal(noCardRefusal(), "must-server-manager");
});

test("연령 제한 카드는 운영자가 켰을 때만 보인다(고치는 것은 막지 않는다)", () => {
  try {
    useDocument("age-content", { enabled: false, changedAt: 1 });
    assert.deepEqual(shownCards("server-manager"), ["channel", "dj", "sponsorblock", "playlistAdd"]);
    assert.equal(fieldRefusal("server-manager", { agePlace: "all" }), null);
    useDocument("age-content", { enabled: true, changedAt: 2 });
    assert.ok(shownCards("server-manager").includes("agePlace"));
  } finally {
    useDefaultDocuments();
  }
});

test("저장 본문의 필드는 모두 어느 한 카드에 속한다(속하지 않은 필드는 권한 확인 없이 지나간다)", () => {
  const claimed = Object.values(CARDS).flatMap((rule) => rule.fields);
  assert.deepEqual([...claimed].sort(), Object.keys(settingsBody({ min: 1, max: 10 }).shape).sort());
  assert.equal(new Set(claimed).size, claimed.length, "한 필드는 한 카드에만");
});

// DJ 카드가 생겼을 때의 판정. 지금 표에는 DJ 카드가 없어 시험용 표로 본다
const WITH_DJ: CardTable = { ...CARDS, playlistAdd: { tier: "dj", fields: ["playlistAddMax"] } };

test("DJ 카드가 있으면: DJ 는 그 카드만 보고, 그 카드의 필드만 고친다. 다른 카드의 필드가 하나라도 있으면 서버 관리자 거절", () => {
  assert.deepEqual(shownCards("dj", WITH_DJ), ["playlistAdd"]);
  assert.equal(fieldRefusal("dj", { playlistAddMax: 50 }, WITH_DJ), null);
  assert.equal(fieldRefusal("dj", { playlistAddMax: 50, djRoleIds: ["r1"] }, WITH_DJ), "must-server-manager");
  assert.equal(fieldRefusal("dj", { botChannelId: null }, WITH_DJ), "must-server-manager", "해제(null)도 고치는 것이다");
  assert.equal(fieldRefusal("server-manager", { playlistAddMax: 50, djRoleIds: ["r1"] }, WITH_DJ), null);
  assert.equal(editsAny("dj", WITH_DJ), true);
});

test("일반 사용자: 카드도 없고 고칠 것도 없다. 거절은 가장 낮은 카드 계층의 것", () => {
  assert.deepEqual(shownCards("user", WITH_DJ), []);
  assert.equal(editsAny("user", WITH_DJ), false);
  assert.equal(fieldRefusal("user", { playlistAddMax: 50 }, WITH_DJ), "must-dj");
  assert.equal(noCardRefusal(WITH_DJ), "must-dj");
  assert.equal(editsAny("user"), false);
});
