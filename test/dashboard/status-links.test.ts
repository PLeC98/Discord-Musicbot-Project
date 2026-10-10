// src/dashboard/status/links.ts — 봇 상태 탭의 연결: 부른 결과와 설정으로 매긴다(쉼 · 실패 · 느림 · 정상 · 쓰지 않음)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { useDocument } from "../helpers/config-docs.ts";
import * as documents from "../../src/config/documents.ts";

// 장르는 Last.fm · VocaDB 만 쓴다
useDocument("genres", "defaults:\n  prefetchCount: 1\ngenres:\n  락:\n    sources:\n      - type: lastfm\n        tags: [rock]\n      - type: vocadb\n");

const config = (await import("../../src/config/index.ts")).default;
const { linkRows } = await import("../../src/dashboard/status/links.ts");
const { _reset, record } = await import("../../src/infra/link-status.ts");
const { _internals: spotify } = await import("../../src/sources/spotify.ts");

/** 설정 문서를 바꾼다 */
function writeConfig(name: "genres" | "status" | "ai", text: string) {
  useDocument(name, text);
}

const client = { isReady: () => true, ws: { ping: 48 } } as unknown as Client;
const rowOf = (id: string) => linkRows(client).find((row) => row.id === id)!;

beforeEach(() => {
  _reset();
  config.sources.lastfmKey = "key";
  config.sources.listenbrainzToken = "";
  config.bgutil.enabled = false;
  config.sponsorblock.enabled = true;
});

test("차례와 무리: 디스코드 · 재생 · 유튜브 · 자동재생", () => {
  assert.deepEqual(
    linkRows(client).map((row) => `${row.group}:${row.id}`),
    ["play:discord", "play:spotify", "play:soundcloud", "play:sponsorblock", "youtube:potoken", "autoplay:ai", "autoplay:lastfm", "autoplay:listenbrainz", "autoplay:animethemes", "autoplay:anisongdb", "autoplay:vocadb", "autoplay:utaitedb", "autoplay:touhoudb"],
  );
});

test("쓰지 않음: 꺼 둠 · 키 없음 · 그 출처를 쓰는 장르가 없음", () => {
  config.sponsorblock.enabled = false;
  const off = Object.fromEntries(linkRows(client).flatMap((row) => (row.state === "off" ? [[row.id, row.note]] : [])));
  assert.deepEqual(off, { sponsorblock: "꺼 둠", potoken: "꺼 둠", ai: "꺼 둠", listenbrainz: "토큰 없음", animethemes: "이 출처를 쓰는 장르가 없음", anisongdb: "이 출처를 쓰는 장르가 없음", utaitedb: "이 출처를 쓰는 장르가 없음", touhoudb: "이 출처를 쓰는 장르가 없음" });
});

test("부른 결과: 없으면 쉼, 마지막이 실패면 실패, 오래 걸렸거나 최근 실패가 잦으면 느림", () => {
  assert.equal(rowOf("lastfm").state, "idle");

  record("lastfm", { ok: true, ms: 340 });
  assert.deepEqual([rowOf("lastfm").state, rowOf("lastfm").latencyMs], ["ok", 340]);

  record("vocadb", { ok: false, ms: 120, error: "HTTP 503" });
  assert.deepEqual([rowOf("vocadb").state, rowOf("vocadb").error, rowOf("vocadb").lastOkAt], ["fail", "HTTP 503", null]);

  record("spotify", { ok: true, ms: 4200 });
  assert.equal(rowOf("spotify").state, "slow", "3초를 넘었다");

  for (let i = 0; i < 3; i++) record("soundcloud", { ok: false, ms: 50, error: "rate-limited" });
  record("soundcloud", { ok: true, ms: 400 });
  assert.deepEqual([rowOf("soundcloud").state, rowOf("soundcloud").note], ["slow", "최근 4번 중 3번 실패"]);
});

test("디스코드는 게이트웨이, POToken 은 서버 프로세스로 본다", () => {
  assert.deepEqual([rowOf("discord").state, rowOf("discord").latencyMs], ["ok", 48]);
  config.bgutil.enabled = true;
  assert.deepEqual([rowOf("potoken").state, rowOf("potoken").note], ["fail", "서버가 떠 있지 않음"]);
});

test("늘 붙는 설명: AI 는 모델, Spotify 는 익명 토큰이 남은 시간, ListenBrainz 는 이름에 올리면 시간 한도", () => {
  writeConfig("ai", ["enabled: true", "provider: ollama", "model: qwen3:8b", ""].join("\n"));
  spotify.graphql._anonToken = { value: "t", expiresAt: Date.now() + 41 * 60_000 + 1000 };
  try {
    assert.deepEqual([rowOf("ai").state, rowOf("ai").note], ["idle", "qwen3:8b"]);
    assert.equal(rowOf("spotify").note, "익명 토큰 41분 남음");
    assert.equal(rowOf("lastfm").hint, null);
    config.sources.listenbrainzToken = "token";
    assert.equal(rowOf("listenbrainz").hint, "LB Radio · 30초 넘으면 실패");
  } finally {
    spotify.graphql._anonToken = null;
    useDocument("ai", documents.defaultOf("ai"));
  }
});

test("장르 설정이 검사를 못 지나면 자동재생 출처는 그 까닭으로 쓰지 않음", () => {
  const good = documents.get("genres");
  useDocument("genres", { genres: "깨짐" });
  try {
    assert.deepEqual([rowOf("vocadb").state, rowOf("vocadb").note], ["off", "장르 설정을 읽지 못함"]);
  } finally {
    useDocument("genres", good);
  }
});
