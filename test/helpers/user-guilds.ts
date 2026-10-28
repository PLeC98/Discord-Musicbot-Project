// 테스트: 로그인 때 받은 디스코드 토큰과 그 사용자의 서버 목록(/users/@me/guilds).
// 토큰은 진짜 세션 저장소(임시 DB)의 세션 행에 두고, 디스코드는 가짜 HTTP 로 답한다. 사용자마다 세션 하나(sid-<사용자 ID>)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { fake } from "./fake.ts";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import { _resetUserGuilds } from "../../src/dashboard/user-guilds.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";

/** guilds: 사용자 ID → 그 사용자가 든 서버 ID(디스코드의 답). failWith: 디스코드가 이 상태 코드로 거절한다(0 이면 답한다) */
function userGuildsFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-user-guilds-"));
  secrets._useKey(newSecretsKey());
  const store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  const state = { guilds: new Map<string, string[]>(), failWith: 0, asked: [] as string[] };
  const http = fake<DiscordHttp>({
    get: async (_url: string, init: { headers: { Authorization: string } }) => {
      const token = init.headers.Authorization.replace(/^Bearer /, "");
      state.asked.push(token);
      if (state.failWith) throw Object.assign(new Error(`HTTP ${state.failWith}`), { response: { status: state.failWith } });
      const ids = state.guilds.get(token.replace(/^tok-/, "")) ?? [];
      return { data: ids.map((id) => ({ id, name: `서버 ${id}`, icon: null, owner: false, permissions: "0" })) };
    },
  });
  /** 그 사용자의 세션 행을 만들고 토큰(tok-<사용자 ID>)을 둔다. token false 면 토큰 없는 세션 */
  const signIn = (userId: string, { token = true }: { token?: boolean } = {}) => {
    const sid = `sid-${userId}`;
    store.set(sid, fake<SessionData>({ cookie: { expires: new Date(Date.now() + 60_000).toISOString() } }));
    if (token) store.saveDiscordToken(sid, `tok-${userId}`);
  };
  /** 요청에 그 사용자의 세션 · 세션 저장소를 붙인다 */
  const middleware = (user: () => { id: string } | null) => (req: Request, _res: Response, next: NextFunction) => {
    const u = user();
    Object.assign(req, { session: fake<Request["session"]>({ user: u, loginAt: Date.now() }), sessionID: `sid-${u?.id ?? "none"}`, sessionStore: store });
    next();
  };
  const reset = () => {
    _resetUserGuilds();
    state.failWith = 0;
    state.asked.length = 0;
  };
  const close = () => {
    store.close();
    _resetUserGuilds();
    secrets._useKey();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  return { http, store, state, signIn, middleware, reset, close };
}

export { userGuildsFixture };
