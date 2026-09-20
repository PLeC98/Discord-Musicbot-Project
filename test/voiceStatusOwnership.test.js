"use strict";

// 음성 채널 상태를 우리가 써도 되는가 — 사람이 적어 둔 것은 건드리지 않는다.
//
// 회귀(2026-09-15 사용자 보고): 사람이 채널 상태를 적어 둔 채로 음악을 틀면 덮어썼다.
// 원인은 prefix 비교가 아니라 현재 값을 알 방법이었다 — REST 채널 객체에는 status가
// 실려 오지 않아(실측) 언제나 빈 문자열로 읽혔고, 빈 값은 "아무도 안 쓴 것"으로 통과했다.
// 실제 값은 게이트웨이(GUILD_CREATE · VOICE_CHANNEL_STATUS_UPDATE)로만 온다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vcs = require("../src/voiceChannelStatus");

const reset = () => vcs._internals._reset();
const CH = "chan-1";

test("사람이 적어 둔 상태가 올라와 있으면 쓰지 않는다", () => {
  reset();
  vcs.consumePacket({ t: "VOICE_CHANNEL_STATUS_UPDATE", d: { id: CH, status: "대충 아무 글자" } });
  assert.equal(vcs.canWrite(CH), false);
});

test("우리가 쓴 값이 이벤트로 되돌아와도 계속 우리 것", () => {
  reset();
  vcs.mark(CH, "▶️ 노래 제목");
  vcs.consumePacket({ t: "VOICE_CHANNEL_STATUS_UPDATE", d: { id: CH, status: "▶️ 노래 제목" } });
  assert.equal(vcs.canWrite(CH), true, "우리 글이 메아리쳐 온 것을 남의 것으로 보면 안 된다");

  // 그 뒤 사람이 바꾸면 그때부터는 남의 것
  vcs.consumePacket({ t: "VOICE_CHANNEL_STATUS_UPDATE", d: { id: CH, status: "회의 중" } });
  assert.equal(vcs.canWrite(CH), false);
});

test("비워지면 다시 쓸 수 있다", () => {
  reset();
  vcs.consumePacket({ t: "VOICE_CHANNEL_STATUS_UPDATE", d: { id: CH, status: "누가 적어 둠" } });
  assert.equal(vcs.canWrite(CH), false);

  vcs.consumePacket({ t: "VOICE_CHANNEL_STATUS_UPDATE", d: { id: CH, status: "" } });
  assert.equal(vcs.canWrite(CH), true);
});

test("기동 시 GUILD_CREATE가 현재 값을 채운다 — 봇이 켜지기 전에 적어 둔 것도 지킨다", () => {
  reset();
  vcs.consumePacket({
    t: "GUILD_CREATE",
    d: {
      channels: [
        { id: "text-1", type: 0 },
        { id: "voice-free", type: 2, status: null },
        { id: "voice-taken", type: 2, status: "공부방" },
      ],
    },
  });

  assert.equal(vcs.canWrite("voice-free"), true, "status가 null이면 비어 있는 것");
  assert.equal(vcs.canWrite("voice-taken"), false);
  assert.equal(vcs.canWrite("text-1"), true, "음성 채널이 아닌 것은 담지 않는다");
});

test("모르는 채널은 쓸 수 있다고 본다 — 소식을 못 들었을 뿐", () => {
  reset();
  assert.equal(vcs.canWrite("본 적 없음"), true);
  assert.equal(vcs.canWrite(null), false, "채널이 없으면 쓸 곳도 없다");
});

test("상태와 무관한 패킷은 무시한다", () => {
  reset();
  for (const packet of [null, {}, { t: "MESSAGE_CREATE", d: { id: CH } }, { t: "VOICE_CHANNEL_STATUS_UPDATE" }]) {
    vcs.consumePacket(packet);
  }
  assert.equal(vcs._internals.current.size, 0);
});
