// dashboard/server/middleware/requireControl.ts — 대시보드 요청의 서버 멤버 확인.
// 세션에 캐시된 서버 목록이 아니라 지금의 멤버십으로 판단하는지, 실패마다 알맞은 상태로 끝내는지.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { fake } from "../helpers/fake.ts";
import { resolveMember } from "../../dashboard/server/middleware/requireControl.ts";

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
  const client = { isReady: () => ready, guilds: { cache: new Map(guild ? [["g1", g]] : []) } };
  const req = fake<Request<{ guildId: string }>>({ app: { locals: { discordClient: client } }, params: { guildId: "g1" }, session: { user: { id: "u1" }, viewAs } });
  const sent: { status?: number; body?: unknown } = {};
  const res = fake<Response>({
    status(code: number) {
      sent.status = code;
      return { json: (body: unknown) => (sent.body = body) };
    },
  });
  return { req, res, sent, fetched, client, g };
}

test("봇이 준비되지 않았으면 503", async () => {
  const { req, res, sent, fetched } = setup({ ready: false });
  assert.equal(await resolveMember(req, res), null);
  assert.equal(sent.status, 503);
  assert.deepEqual(fetched, []);
});

test("봇이 없는 서버면 404", async () => {
  const { req, res, sent } = setup({ guild: false });
  assert.equal(await resolveMember(req, res), null);
  assert.equal(sent.status, 404);
});

test("세션 사용자가 지금 그 서버 멤버가 아니면 403", async () => {
  const { req, res, sent, fetched } = setup({ member: false });
  assert.equal(await resolveMember(req, res), null);
  assert.equal(sent.status, 403);
  assert.deepEqual(fetched, ["u1"], "세션 사용자 ID 로 서버에 묻는다");
});

test("멤버면 응답을 쓰지 않고 서버 · 멤버를 돌려준다", async () => {
  const { req, res, sent, client, g } = setup();
  const got = await resolveMember(req, res);
  assert.deepEqual(sent, {});
  assert.equal(got?.client, client);
  assert.equal(got?.guild, g);
  assert.equal((got?.member as unknown as Member).id, "u1");
});

test("권한 보기 전환(viewAs)이 걸려 있으면 권한만 바꾼 멤버를 돌려준다", async () => {
  const { req, res } = setup({ viewAs: "user" });
  const member = (await resolveMember(req, res))?.member as unknown as Member;
  assert.equal(member.id, "u1");
  assert.notEqual(member.permissions, "real");
});
