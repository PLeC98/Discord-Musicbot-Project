// src/rules/app-owners.ts: 앱 정보에서 봇 운영자와 초대할 수 있는 사람을 정한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { canInviteBy, operatorsOf, overrideIds, readAppOwners } from "../../src/rules/app-owners.ts";
import { personalApp, teamApp } from "../helpers/app-owners.ts";

const read = (raw: unknown) => {
  const app = readAppOwners(raw);
  assert.ok(app, "형식을 확인한 앱 정보");
  return app;
};

test("개인 앱은 소유자 한 명이다", () => {
  assert.deepEqual(operatorsOf(read(personalApp("u1")), "developer"), ["u1"]);
});

test("팀 앱: 기본은 팀 소유자만이고 팀의 가짜 사용자(owner.id)는 쓰지 않는다", () => {
  const app = read(
    teamApp("t1", [
      { id: "t1", role: "admin" },
      { id: "t2", role: "admin" },
      { id: "t3", role: "developer" },
    ]),
  );
  assert.deepEqual(operatorsOf(app, "owner"), ["t1"]);
});

test("팀 앱: 넓히면 Admin, Developer 까지. 소유자는 role 이 admin 으로 와도 한 번. Read-only, 초대만 받은 사람은 넣지 않는다", () => {
  const app = read(
    teamApp("t1", [
      { id: "t1", role: "admin" },
      { id: "t2", role: "admin" },
      { id: "t3", role: "developer" },
      { id: "t4", role: "read_only" },
      { id: "t5", role: "admin", state: 1 },
    ]),
  );
  assert.deepEqual(operatorsOf(app, "admin"), ["t1", "t2"]);
  assert.deepEqual(operatorsOf(app, "developer"), ["t1", "t2", "t3"]);
});

test("팀 소유자가 members 에 없어도 owner_user_id 로 넣는다", () => {
  assert.deepEqual(operatorsOf(read(teamApp("t1", [{ id: "t2", role: "admin" }])), "admin"), ["t1", "t2"]);
});

test("형식이 틀린 응답은 모르는 것으로 본다(team 이 없음, 팀원의 형식이 틀림, 개인 앱인데 owner 가 없음)", () => {
  const personal = personalApp("u1");
  const { team: _team, ...noTeam } = personal;
  assert.equal(readAppOwners(noTeam), null, "team 이 없으면 팀 앱의 가짜 사용자를 소유자로 읽을 수 있다");
  assert.equal(readAppOwners({ ...personal, owner: null }), null);
  const team = teamApp("t1", []);
  assert.equal(readAppOwners({ ...team, team: { ...team.team, owner_user_id: 5 } }), null);
  assert.equal(readAppOwners({ ...team, team: { ...team.team, members: [{ role: "admin" }] } }), null);
  const noId = readAppOwners({ ...team, team: { ...team.team, id: undefined } });
  assert.deepEqual([noId?.kind, noId?.kind === "team" && noId.teamId], ["team", null], "팀 ID 가 없어도 운영자는 정한다(팀 페이지 링크만 빠진다)");
  assert.equal(readAppOwners("x"), null);
});

test("초대: 공개면 누구나, 비공개면 소유자와 수락한 팀원(Read-only 도), code grant 를 요구하거나 모르면 아무도", () => {
  assert.equal(canInviteBy(read(personalApp("u1", { botPublic: true })), "x"), true);
  assert.deepEqual(
    ["u1", "x"].map((id) => canInviteBy(read(personalApp("u1")), id)),
    [true, false],
  );
  const team = read(
    teamApp("t1", [
      { id: "t4", role: "read_only" },
      { id: "t5", role: "admin", state: 1 },
    ]),
  );
  assert.deepEqual(
    ["t1", "t4", "t5", "team-pseudo-user"].map((id) => canInviteBy(team, id)),
    [true, true, false, false],
  );
  assert.equal(canInviteBy(read(personalApp("u1", { botPublic: true, codeGrant: true })), "u1"), false);
  assert.equal(canInviteBy(read({ ...personalApp("u1", { botPublic: true }), bot_require_code_grant: undefined }), "u1"), false, "code grant 를 모르면 아무도");
  assert.equal(canInviteBy(null, "u1"), false);
});

test("덮어쓰기 목록: 쉼표로 여럿, 앞뒤 공백은 지우고, 비면 null. 형식은 보지 않는다", () => {
  assert.deepEqual(overrideIds(" 1, 2 ,, owner "), ["1", "2", "owner"]);
  assert.equal(overrideIds(""), null);
  assert.equal(overrideIds(null), null);
});
