// src/infra/gateway-sessions.ts: 샤드마다 게이트웨이 새 세션(원본 READY)을 받은 때를 적는다. 재개는 세지 않는다
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { watchGatewaySessions, newSessionAt } from "../../src/infra/gateway-sessions.ts";

test("원본 READY 를 받은 샤드만 그때를 적고, 재개(RESUMED) · 다른 패킷은 세지 않는다", () => {
  const client = new EventEmitter();
  watchGatewaySessions(client as never);
  assert.equal(newSessionAt(7), null);
  client.emit(Events.Raw, { t: "RESUMED" }, 7);
  client.emit(Events.Raw, { t: "GUILD_CREATE" }, 7);
  assert.equal(newSessionAt(7), null);
  const before = Date.now();
  client.emit(Events.Raw, { t: "READY" }, 7);
  const at = newSessionAt(7);
  assert.ok(at !== null && at >= before);
  assert.equal(newSessionAt(8), null, "다른 샤드는 그대로");
});
