// src/app/privileged-intents.ts: 기동이 앱 설정으로 특권 인텐트를 고르고, 거절되면 무엇을 켜면 되는지 알린다

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayIntentBits } from "discord.js";
import sink from "../../src/infra/log/sink.ts";
import { FLAGS, loggedInIntents, _resetIntents } from "../../src/infra/gateway-intents.ts";
import { choosePrivilegedIntents, refusedAtLogin, onRefusedWhileRunning, _resetPrivilegedIntents } from "../../src/app/privileged-intents.ts";

afterEach(() => {
  _resetIntents();
  _resetPrivilegedIntents();
});

const BASE = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates];
const linesFrom = (from: number) => sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);

test("둘 다 켜져 있으면 다섯을 요청하고 아무것도 알리지 않는다", async () => {
  const from = sink.buffer.length;
  const intents = choosePrivilegedIntents({ flags: FLAGS.messageContent.limited | FLAGS.guildMembers.limited, approximate_guild_count: 2 });
  assert.deepEqual(intents, [...BASE, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]);
  assert.deepEqual(loggedInIntents(), { messageContent: true, guildMembers: true });
  assert.deepEqual(linesFrom(from), []);
});

test("꺼진 것은 빼고 요청하고, 무엇을 껐고 포털의 어디를 켜면 되는지 warn. 이 프로세스의 인텐트로 적는다", async () => {
  const from = sink.buffer.length;
  const intents = choosePrivilegedIntents({ flags: FLAGS.guildMembers.limited, approximate_guild_count: 2 });
  assert.deepEqual(intents, [...BASE, GatewayIntentBits.GuildMembers]);
  assert.deepEqual(loggedInIntents(), { messageContent: false, guildMembers: true });
  const lines = linesFrom(from);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^warn 특권 인텐트 Message Content Intent 꺼짐: 전용 채널에 채팅으로 곡을 넣는 기능을 끄고 기동 \| 개발자 포털 → 앱 → Bot → Privileged Gateway Intents에서 켜고 다시 시작$/);
});

test("100 서버 이상이면 스위치가 아니라 승인이 필요하다고 알린다", async () => {
  const from = sink.buffer.length;
  choosePrivilegedIntents({ flags: FLAGS.messageContent.full | FLAGS.guildMembers.limited, approximate_guild_count: 150 });
  assert.deepEqual(loggedInIntents(), { messageContent: true, guildMembers: false });
  assert.match(linesFrom(from)[0], /Server Members Intent 꺼짐: .* \| 서버가 100개 이상이라 디스코드의 승인이 필요함/);
  assert.match(refusedAtLogin(), /승인이 필요함/);
});

test("앱 설정에 flags가 없으면 모르는 것이라 다섯 개를 모두 요청한다", () => {
  const from = sink.buffer.length;
  assert.equal(choosePrivilegedIntents({ approximate_guild_count: 2 }).length, 5);
  assert.deepEqual(loggedInIntents(), { messageContent: true, guildMembers: true });
  assert.match(linesFrom(from)[0], /^warn 앱 설정에 인텐트 플래그\(flags\)가 없어 특권 인텐트를 모두 요청함/);
});

test("로그인이 거절되면(4014) 두 스위치를 다 안내한다(어느 것인지 모른다)", () => {
  assert.equal(refusedAtLogin(), "로그인 거절: 개발자 포털에서 꺼진 특권 인텐트를 요청함 | Server Members Intent, Message Content Intent: 개발자 포털 → 앱 → Bot → Privileged Gateway Intents에서 켜고 다시 시작");
});

test("실행 중 4014: 실행기가 있으면 다시 시작하고, 없으면 무엇을 하라고 알리고 남는다", () => {
  const restarts: string[] = [];
  const from = sink.buffer.length;
  onRefusedWhileRunning((why) => restarts.push(why));
  assert.deepEqual(restarts, ["특권 인텐트 거절"]);
  onRefusedWhileRunning(null);
  const lines = linesFrom(from);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^error .*\(4014\) \| 다시 시작해 켜진 특권 인텐트만 요청함$/);
  assert.match(lines[1], /^error .*재연결하지 않음 \| 봇을 다시 시작하면 꺼진 인텐트가 필요한 기능만 끄고 기동/);
});
