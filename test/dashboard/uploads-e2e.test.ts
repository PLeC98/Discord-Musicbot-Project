// dashboard/src/utils/chunk-upload.ts → src/dashboard/routes/uploads.ts: 화면의 업로드 함수로 실제 앱에 끝까지 올린다.
// 여러 청크, 보내는 도중 연결이 끊겨도 받은 위치부터 이어 올리기, 두 업로드 동시에, 같은 세션이 다시 시작하면 옛 업로드를 지우기

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import axios from "../../dashboard/node_modules/axios/index.js";
import { fake, fakeBot } from "../helpers/fake.ts";
import { listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("uploads-e2e-");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const uploads = await import("../../src/dashboard/uploads.ts");
const archiveUploads = await import("../../src/dashboard/archive-uploads.ts");
const { uploadFile } = await import("../../dashboard/src/utils/chunk-upload.ts");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-e2e-"));
archiveUploads._useDir(DIR);
const TOKEN = "t".repeat(43);
const fakeSession = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: { id: "owner", username: "owner" }, loginAt: Date.now(), csrfToken: TOKEN, destroy: (done: () => void) => done() });
  next();
};
const server = await listenForFetch(createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: fakeSession }), "127.0.0.1");
const appPort = (server.address() as AddressInfo).port;

// 앱 앞의 중계. cutAt 을 정한 뒤로 보낸 바이트가 그만큼을 넘으면 그 연결을 그 자리에서 끊는다(한 번만. 앞 테스트의 keep-alive 연결이 보낸 양은 세지 않는다)
let cutAt: number | null = null;
let sinceArmed = 0;
const proxy = net.createServer((client) => {
  const upstream = net.connect(appPort, "127.0.0.1");
  client.on("data", (chunk: Buffer) => {
    if (cutAt !== null) sinceArmed += chunk.length;
    if (cutAt !== null && sinceArmed > cutAt) {
      cutAt = null;
      client.destroy();
      upstream.destroy();
      return;
    }
    upstream.write(chunk);
  });
  upstream.pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
});
await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
// 브라우저의 XHR 처럼 Blob 크기를 Content-Length 로 싣는 Node http 방식. fetch 방식은 진행률을 받으면 길이 없이 조각으로 보내 봇이 거절한다(청크는 길이를 명시해야 한다)
const http = axios.create({ adapter: "http", baseURL: origin, headers: { "x-csrf-token": TOKEN } });

after(() => {
  uploads._reset();
  proxy.close();
  server.close();
  store.close();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

/** 다 올린 업로드의 받은 파일(가져가기 전이라 .part) */
const received = (id: string) => fs.readFileSync(path.join(DIR, `archive-${id}.zip.part`));

test("여러 청크로 끝까지 올리고 받은 파일이 보낸 것과 같다. 진행률은 1 로 끝난다", async () => {
  const body = crypto.randomBytes(uploads.CHUNK_SIZE * 2 + 12345);
  const shares: number[] = [];
  const id = await uploadFile(new Blob([body]), "archive", { http, onProgress: (share) => shares.push(share) });
  assert.ok(received(id).equals(body));
  assert.equal(shares.at(-1), 1);
});

test("보내는 도중 연결이 끊기면 봇이 받은 위치를 물어 이어 올린다", async () => {
  const body = crypto.randomBytes(uploads.CHUNK_SIZE + 4096);
  sinceArmed = 0;
  cutAt = 3 * 1024 * 1024;
  const id = await uploadFile(new Blob([body]), "archive", { http });
  assert.equal(cutAt, null, "한 번 끊었다");
  assert.ok(received(id).equals(body));
});

test("두 업로드가 동시에 올라간다", async () => {
  const one = crypto.randomBytes(uploads.CHUNK_SIZE + 1);
  const two = crypto.randomBytes(uploads.CHUNK_SIZE + 2);
  const [a, b] = await Promise.all([uploadFile(new Blob([one]), "archive", { http }), uploadFile(new Blob([two]), "login-background", { http }).catch((error: unknown) => error)]);
  assert.ok(received(a).equals(one));
  // 로그인 배경은 다른 폴더에 받는다. 둘이 서로를 막지 않았는지만 본다
  assert.equal(typeof b, "string", String(b));
});

test("같은 세션이 같은 용도로 다시 시작하면 쥐지 않은 옛 업로드를 지운다", async () => {
  const old = (await http.post<{ id: string }>("/api/admin/uploads", { purpose: "archive", size: 10 })).data.id;
  await uploadFile(new Blob([Buffer.alloc(10, 1)]), "archive", { http });
  const gone = await http.get(`/api/admin/uploads/${old}`).catch((error: { response?: { status?: number } }) => error.response?.status);
  assert.equal(gone, 410);
});
