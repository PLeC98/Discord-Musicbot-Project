"use strict";

// commands/search.js + events/buttonHandler.js — 검색 결과 저장/선택 계약.
// 회귀 대상: 사용자 ID 하나로만 키잉되어 같은 사용자의 재검색이 이전 메시지의 버튼과
// 뒤섞이고, 각 검색의 5분 타이머가 최신 결과를 조기 삭제하던 문제 (감사 M-08 + 구 리뷰 §2.4)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const searchCommand = require("../commands/search");
const buttonHandler = require("../events/buttonHandler");

function makeClient() {
  return {
    players: new Map(),
    musicEmbedManager: {
      calls: [],
      async handleMusicData(guildId, trackData, member, interaction) {
        this.calls.push({ guildId, trackData, member, interaction });
        return { success: true };
      },
    },
  };
}

// showSearchMenu용 — editReply가 지정된 ID의 메시지를 돌려줌
function makeSearchInteraction(client, { userId = "u1", messageId }) {
  return {
    user: { id: userId },
    client,
    editReply: async () => ({ id: messageId }),
  };
}

// handleSearchInteraction용 — 봇 유휴 + 요청자 음성 접속 상태 (권한 검사 통과 경로)
function makeButtonInteraction(client, { messageId, userId = "u1", customId, guildId = "g1" }) {
  const interaction = {
    customId,
    user: { id: userId },
    client,
    message: { id: messageId },
    channel: { id: "tc1" },
    member: { voice: { channel: { id: "vc1" } } },
    guild: { id: guildId, members: { me: { voice: { channel: null } } } },
    replies: [],
    updates: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.updates.push(payload);
    },
    async deferUpdate() {},
    async editReply() {},
    async deleteReply() {},
  };
  return interaction;
}

// 검색 2건을 저장하고 만료 타이머 콜백을 캡처해 돌려줌
async function seedTwoSearches(client) {
  const trackA = { title: "곡 A", url: "https://a" };
  const trackB = { title: "곡 B", url: "https://b" };

  const timers = [];
  const origSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    timers.push(fn);
    return { unref() {} };
  };
  try {
    await searchCommand.showSearchMenu(makeSearchInteraction(client, { messageId: "m1" }), [trackA], "첫 검색");
    await searchCommand.showSearchMenu(makeSearchInteraction(client, { messageId: "m2" }), [trackB], "재검색");
  } finally {
    global.setTimeout = origSetTimeout;
  }

  // 대기 중인 플레이어가 있는 것처럼 — MusicPlayer 생성 없이 기존 플레이어 갱신 경로 사용
  client.players.set("g1", { voiceChannel: null, textChannel: null });

  return { trackA, trackB, timers };
}

test("재검색해도 각 메시지의 버튼은 자기 검색 결과를 선택 (M-08 회귀)", async () => {
  const client = makeClient();
  const { trackA, trackB } = await seedTwoSearches(client);

  assert.equal(client.searchResults.size, 2, "두 검색이 독립 레코드로 공존");

  // 첫 검색 메시지의 1번 버튼 — 구 코드라면 최신(두 번째) 결과가 선택됐음
  await buttonHandler.handleSearchInteraction(makeButtonInteraction(client, { messageId: "m1", customId: "search_select_0" }), client);
  assert.equal(client.musicEmbedManager.calls.length, 1);
  assert.equal(client.musicEmbedManager.calls[0].trackData.tracks[0], trackA);
  assert.equal(client.searchResults.has("m1"), false, "선택된 검색의 레코드는 정리됨");

  // 두 번째 검색 메시지는 여전히 유효
  await buttonHandler.handleSearchInteraction(makeButtonInteraction(client, { messageId: "m2", customId: "search_select_0" }), client);
  assert.equal(client.musicEmbedManager.calls[1].trackData.tracks[0], trackB);
});

test("만료 타이머는 자기 검색 레코드만 삭제 (조기 삭제 회귀)", async () => {
  const client = makeClient();
  const { timers } = await seedTwoSearches(client);

  timers[0](); // 첫 검색 만료 — 구 코드라면 같은 사용자 키를 지워 최신 검색도 사라졌음
  assert.equal(client.searchResults.has("m1"), false);
  assert.equal(client.searchResults.has("m2"), true, "최신 검색은 이전 검색의 타이머에 영향받지 않음");
});

test("검색 요청자가 아닌 사용자는 선택 불가", async () => {
  const client = makeClient();
  await seedTwoSearches(client);

  const interaction = makeButtonInteraction(client, { messageId: "m1", userId: "u2", customId: "search_select_0" });
  await buttonHandler.handleSearchInteraction(interaction, client);

  assert.equal(client.musicEmbedManager.calls.length, 0);
  assert.equal(interaction.replies.length, 1, "요청자 아님 안내 응답");
  assert.equal(client.searchResults.has("m1"), true, "레코드는 유지 — 요청자는 계속 사용 가능");
});

test("취소 버튼은 레코드를 삭제하고 메시지를 갱신", async () => {
  const client = makeClient();
  await seedTwoSearches(client);

  const interaction = makeButtonInteraction(client, { messageId: "m1", customId: "search_cancel" });
  await buttonHandler.handleSearchInteraction(interaction, client);

  assert.equal(client.searchResults.has("m1"), false);
  assert.equal(interaction.updates.length, 1, "취소 임베드로 갱신");
  assert.equal(client.musicEmbedManager.calls.length, 0);
});

test("만료/모르는 메시지의 버튼은 재검색 안내", async () => {
  const client = makeClient();
  await seedTwoSearches(client);

  const interaction = makeButtonInteraction(client, { messageId: "m-없음", customId: "search_select_0" });
  await buttonHandler.handleSearchInteraction(interaction, client);

  assert.equal(client.musicEmbedManager.calls.length, 0);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /만료/);
});
