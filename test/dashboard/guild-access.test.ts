// src/dashboard/guild-access.ts — 대시보드 요청이 서버 하나를 여는 법.
// 세션에 캐시된 서버 목록이 아니라 지금의 멤버십으로 판단하는지, 운영자는 멤버가 아니어도 지나가는지, 실패마다 알맞은 상태로 끝내는지.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { fake } from "../helpers/fake.ts";
import { withConfig } from "../helpers/config.ts";
import { openGuild } from "../../src/dashboard/guild-access.ts";

type Member = { id: string; permissions?: unknown };

function setup({ ready = true, guild = true, member = true, viewAs }: { ready?: boolean; guild?: boolean; member?: boolean; viewAs?: string } = {}) {
  const fetched: string[] = [];
  const g = {
    members: {
      fetch: async (id: string) => {
        fetched.push(id);
        if (!member) throw new Error("Unknown Member");
        return { id, permissions: "real" } satisfies Member;
      },
    },
  };
  const player = { guildId: "g1" };
  const client = { isReady: () => ready, guilds: { cache: new Map(guild ? [["g1", g]] : []) }, players: new Map([["g1", player]]) };
  const req = fake<Request<{ guildId: string }>>({ app: { locals: { discordClient: client } }, params: { guildId: "g1" }, session: { user: { id: "u1" }, viewAs } });
  const sent: { status?: number; body?: unknown } = {};
  const res = fake<Response>({
    status(code: number) {
      sent.status = code;
      const chain = { type: () => chain, json: (body: unknown) => (sent.body = body) };
      return chain;
    },
  });
  return { req, res, sent, fetched, client, g, player };
}

const codeOf = (sent: { status?: number; body?: unknown }) => [sent.status, (sent.body as { code: string }).code];

test("봇이 준비되지 않았으면 503", async () => {
  const { req, res, sent, fetched } = setup({ ready: false });
  assert.equal(await openGuild(req, res, "g1"), null);
  assert.deepEqual(codeOf(sent), [503, "bot-not-ready"]);
  assert.deepEqual(fetched, []);
});

test("봇이 없는 서버면 404", async () => {
  const { req, res, sent } = setup({ guild: false });
  assert.equal(await openGuild(req, res, "g1"), null);
  assert.deepEqual(codeOf(sent), [404, "guild-not-found"]);
});

test("세션 사용자가 지금 그 서버 멤버가 아니면 403", async () => {
  const { req, res, sent, fetched } = setup({ member: false });
  assert.equal(await openGuild(req, res, "g1"), null);
  assert.deepEqual(codeOf(sent), [403, "no-guild-access"]);
  assert.deepEqual(fetched, ["u1"], "세션 사용자 ID 로 서버에 묻는다");
});

test("멤버면 응답을 쓰지 않고 서버 · 플레이어 · 멤버를 돌려준다. 조작하는 사람은 그 멤버다", async () => {
  const { req, res, sent, client, g, player } = setup();
  const got = await openGuild(req, res, "g1");
  assert.deepEqual(sent, {});
  assert.equal(got?.client, client);
  assert.equal(got?.guild, g);
  assert.equal(got?.player, player);
  assert.equal((got?.member as unknown as Member).id, "u1");
  assert.equal(got?.actor.member, got?.member);
});

test("운영자는 그 서버 멤버가 아니어도 운영자로 연다", async () => {
  const { req, res, sent } = setup({ member: false });
  const got = await withConfig({ dashboard: { ownerId: "u1" } }, () => openGuild(req, res, "g1"));
  assert.deepEqual(sent, {});
  assert.deepEqual(got?.actor, { owner: true });
  assert.equal(got?.member, null);
});

test("권한 보기 전환(viewAs)이 걸려 있으면 권한만 바꾼 멤버로 판정한다(운영자도 그 계층의 멤버가 된다)", async () => {
  const { req, res } = setup({ viewAs: "user" });
  const got = await withConfig({ dashboard: { ownerId: "u1" } }, () => openGuild(req, res, "g1"));
  const member = got?.actor.member as unknown as Member;
  assert.equal(member.id, "u1");
  assert.notEqual(member.permissions, "real");
});
