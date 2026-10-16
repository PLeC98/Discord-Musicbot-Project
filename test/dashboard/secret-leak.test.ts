// 비밀값 누출 시험(2차 16단계 "정한 것" 8). 가짜 비밀값을 모든 자리(서비스 키 · AI 키 · 버텍스 JSON · 쿠키)에 넣고,
// 운영자가 부를 수 있는 읽기 경로 · 내보내기 파일 · 로그 어디에도 그 값이 나오지 않는지 본다. 끝 네 글자는 화면에 보이는 값이라 뺀 나머지로 본다.
// 읽기 경로는 라우터에서 읽어 모두 부른다(경로가 늘어도 이 시험에 저절로 들어온다)

process.env.OWNER_ID = "owner";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response, Router } from "express";

const { baseUrl } = await import("../helpers/listen.ts");
const { fake, fakeBot } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { unzip } = await import("../../src/infra/zip.ts");
const secrets = await import("../../src/store/secrets.ts");
const serviceKeys = await import("../../src/store/service-keys.ts");
const aiKeys = await import("../../src/store/ai-keys.ts");
const cookieJar = await import("../../src/store/cookie-jar.ts");
const assist = await import("../../src/autoplay/assist/index.ts");
const sourcesHttp = await import("../../src/autoplay/sources/http.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { adminRouter } = await import("../../src/dashboard/routes/admin.ts");
const { serviceKeysRouter } = await import("../../src/dashboard/routes/service-keys.ts");
const { tunablesRouter } = await import("../../src/dashboard/routes/tunables.ts");
const { settingsArchiveRouter } = await import("../../src/dashboard/routes/settings-archive.ts");
const { snapshotsRouter } = await import("../../src/dashboard/routes/snapshots.ts");
const { identityRouter } = await import("../../src/dashboard/routes/identity.ts");
const { loginBackgroundRouter } = await import("../../src/dashboard/routes/login-background.ts");
const loginBackground = await import("../../src/dashboard/login-background/store.ts");

const store = openTempStore("secret-leak-");
// 로그인 배경 기록은 실제 저장 자리 대신 임시 폴더에서
const BACKGROUNDS = fs.mkdtempSync(path.join(os.tmpdir(), "secret-leak-bg-"));
loginBackground._useDir(BACKGROUNDS);
after(() => fs.rmSync(BACKGROUNDS, { recursive: true, force: true, maxRetries: 5 }));
secrets._useKey(Buffer.alloc(32, 9).toString("base64"));

// 값마다 다른 글자. 끝 네 글자(화면에 보이는 것)를 뺀 앞부분이 어디에도 없어야 한다
const mark = (what: string) => `LEAK-${what}-${crypto.randomBytes(12).toString("hex")}`;
const SERVICE = { spotify: { clientId: mark("spotify-id"), clientSecret: mark("spotify-secret") }, lastfm: { apiKey: mark("lastfm") }, listenbrainz: { token: mark("listenbrainz") } };
const AI = { openai: mark("openai"), anthropic: mark("anthropic"), custom: mark("custom") };
const PRIVATE_KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
const VERTEX = JSON.stringify({ client_email: "leak@p.iam.gserviceaccount.com", private_key: PRIVATE_KEY, project_id: "leak-project" });
const COOKIE = mark("cookie");
const COOKIES = `# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\t${COOKIE}\n`;

// 찾을 조각: 비밀마다 끝 네 글자를 뺀 앞부분, 버텍스는 비밀 키 몸통의 한 줄
const NEEDLES = [...Object.values(SERVICE).flatMap((one) => Object.values(one)), ...Object.values(AI), COOKIE].map((value) => value.slice(0, -4));
NEEDLES.push(PRIVATE_KEY.split("\n")[1]);

function leaksIn(where: string, body: string) {
  for (const needle of NEEDLES) assert.ok(!body.includes(needle), `${where} 에 비밀값이 나왔다`);
}

// 세션 하나를 모든 요청이 나눠 쓴다(CSRF 토큰도 거기 담긴다). 방금 로그인한 운영자
const session = fake<Request["session"]>({ user: { id: "owner", username: "owner", globalName: "owner", avatar: null, guilds: [] }, loginAt: Date.now() });
const signedIn = (req: Request, _res: Response, next: NextFunction) => {
  req.session = session;
  next();
};
const client = { isReady: () => true, user: { tag: "bot#0001", id: "1", username: "bot", avatarURL: () => null, displayAvatarURL: () => null }, guilds: { cache: new Map() }, ws: { ping: 10, status: 0 }, application: { commands: { cache: new Map() } } };

let base = "";
let csrf = "";
const server = createApp(fakeBot({ client }), { stream: createPlayerStream(), deployCommands: async () => ({ ok: true, skipped: false, count: 0, scope: "global", guildId: null, names: [] }), sessionMiddleware: signedIn }).listen(0, "127.0.0.1");

before(async () => {
  // 소스 목록 · 자동완성이 바깥(AnimeThemes 등)에 묻지 않게. 이 시험은 바깥 상태에 기대지 않는다
  sourcesHttp.useFetch(fake<typeof fetch>(async () => Promise.reject(new Error("시험은 바깥에 나가지 않는다"))));
  await new Promise((resolve) => server.once("listening", resolve));
  base = baseUrl(server);
  csrf = ((await (await fetch(`${base}/api/csrf-token`)).json()) as { csrfToken: string }).csrfToken;

  for (const [service, values] of Object.entries(SERVICE)) serviceKeys.save(service as keyof typeof SERVICE, values);
  for (const [provider, value] of Object.entries(AI)) aiKeys.put(provider, value, assist.keyBinding({ provider, baseUrl: "http://127.0.0.1:1/v1" }));
  aiKeys.put("vertex", VERTEX, assist.keyBinding({ provider: "vertex" }));
  assert.equal(cookieJar.save(COOKIES), true);
});
after(() => {
  server.close();
  assist.useFetch(null);
  sourcesHttp.useFetch(null);
  secrets._useKey();
  store.close();
});

// 라우터의 GET 경로. 경로 변수는 시험할 값으로 채우고, 바깥에 묻는 경로 · 실시간 연결은 뺀다
const MOUNTS: Array<[string, Router]> = [
  ["/api/admin", adminRouter],
  ["/api/admin/service-keys", serviceKeysRouter],
  ["/api/admin/tunables", tunablesRouter],
  ["/api/admin/settings-archive", settingsArchiveRouter],
  ["/api/admin/snapshots", snapshotsRouter],
  ["/api/admin/appearance/login-background", loginBackgroundRouter],
  ["/api", identityRouter],
];
// 로그인 배경의 미리보기는 그 배경의 영상 · 그림 파일이다(배경이 있어야 답한다)
const SKIP = new Set(["/api/admin/logs/stream", "/api/admin/source-suggest", "/api/admin/appearance/login-background/svg/preview"]);
const FILL: Record<string, string[]> = { ":name": ["genres", "status", "ai"], ":id": ["svg"], ":size": ["32"] };
// 물음표 뒤가 있어야 답하는 경로
const QUERY: Record<string, string[]> = { "/api/admin/settings-archive/export": ["?kind=settings", "?kind=full"] };

function getPaths() {
  const out: string[] = [];
  for (const [mount, router] of MOUNTS) {
    for (const layer of router.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>) {
      if (!layer.route?.methods.get || typeof layer.route.path !== "string") continue;
      let paths = [`${mount}${layer.route.path === "/" ? "" : layer.route.path}`];
      for (const [param, values] of Object.entries(FILL)) paths = paths.flatMap((one) => (one.includes(param) ? values.map((value) => one.replace(param, value)) : [one]));
      out.push(...paths.filter((one) => !SKIP.has(one)).flatMap((one) => (QUERY[one] ?? [""]).map((query) => one + query)));
    }
  }
  return out;
}

test("운영자의 모든 읽기 경로 응답에 비밀값이 없다", async () => {
  const paths = getPaths();
  assert.ok(paths.length >= 15, `읽기 경로를 찾았다(${paths.length}개)`);
  const failed: string[] = [];
  for (const path of paths) {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(10_000) });
    if (res.status >= 400) failed.push(`${path} ${res.status}`);
    leaksIn(`GET ${path}`, Buffer.from(await res.arrayBuffer()).toString("utf8"));
  }
  assert.deepEqual(failed, [], "답이 와야 그 답을 본 것이다(거절 · 서버 오류면 내용을 보지 못한다)");
});

test("서비스 키 · AI 키 상태는 끝 네 글자까지만 보인다", async () => {
  const view = await (await fetch(`${base}/api/admin/service-keys`)).text();
  assert.ok(view.includes(SERVICE.lastfm.apiKey.slice(-4)), "끝 네 글자는 보인다(넣은 것을 알아보게)");
  leaksIn("서비스 키 상태", view);
});

// 나갈 요청을 미리 보여 주는 길은 키 자리를 가린다. 보내는 길(모델 목록 · 시험)도 응답에 키를 싣지 않는다
test("AI 미리보기 · 모델 묻기 · 시험 응답에 키가 없다", async () => {
  assist.useFetch(fake<typeof fetch>(async () => ({ ok: false, status: 401, headers: new Headers(), text: async () => "unauthorized", json: async () => ({ error: "unauthorized" }) })));
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
  for (const provider of ["openai", "anthropic", "custom", "vertex"]) {
    const data = { enabled: true, provider, baseUrl: "http://127.0.0.1:1/v1", model: "m", location: "global", project: "p" };
    for (const path of ["/api/admin/ai/preview", "/api/admin/ai/models", "/api/admin/ai/ping"]) leaksIn(`POST ${path} (${provider})`, await (await post(path, { data })).text());
  }
});

// 암호화된 설정까지 내보내도 값은 암호문으로만 나간다(끝 네 글자도 담지 않는다)
test("내보내기 파일(두 종류, ZIP 의 모든 항목)에 비밀값이 없다", async () => {
  for (const kind of ["settings", "full"]) {
    const res = await fetch(`${base}/api/admin/settings-archive/export?kind=${kind}`);
    assert.equal(res.status, 200);
    for (const entry of unzip(Buffer.from(await res.arrayBuffer()))) leaksIn(`내보내기(${kind}) ${entry.name}`, entry.data.toString("utf8"));
  }
});

test("지금까지의 로그(실시간 로그 · 로그 경로가 읽는 버퍼)에 비밀값이 없다", async () => {
  leaksIn("로그 버퍼", JSON.stringify(sink.buffer));
  leaksIn("최근 경고 · 오류", JSON.stringify(sink.recentProblems()));
});
