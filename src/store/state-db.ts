// 실행 상태 DB(state.db). 봇을 다시 켰을 때 이어 가려고 남기는 것: 저장된 대기열(재생 세션) · 음성 채널 상태 · 재생 패널 자리.
// 캐시 초기화와 무관하다. 구조 버전이 맞지 않으면 열지 않고 멈춘다(지우고 다시 켜라고 안내한다).

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const stateDb = new DbFile({
  label: "실행 상태 DB",
  fileName: "state.db",
  version: 1,
  synchronous: "NORMAL",
  onMismatch: { lost: "저장된 대기열 · 음성 채널 상태 · 재생 패널 자리가 사라집니다." },
  createTables,
});

function createTables(db: Db) {
  db.exec(`
    -- 플레이어 세션(재시작 복원용). 행 구조와 쓰기는 player-sessions
    CREATE TABLE IF NOT EXISTS player_sessions (
      guild_id               TEXT    PRIMARY KEY,
      voice_channel_id       TEXT,
      text_channel_id        TEXT,
      volume                 INTEGER NOT NULL DEFAULT 100,
      loop_mode              TEXT    NOT NULL DEFAULT 'off' CHECK (loop_mode IN ('off', 'track', 'queue')),
      autoplay               TEXT,
      paused_manual          INTEGER NOT NULL DEFAULT 0,
      position_ms            INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_tracks (
      guild_id         TEXT    NOT NULL REFERENCES player_sessions(guild_id) ON DELETE CASCADE,
      slot             TEXT    NOT NULL CHECK (slot IN ('current', 'queue', 'history')),
      seq              INTEGER NOT NULL,
      track_id         TEXT,
      page_url         TEXT,
      request_key      TEXT,
      audio_url        TEXT,
      title            TEXT,
      artist           TEXT,
      album            TEXT,
      uploader         TEXT,
      duration_sec     REAL,
      thumbnail        TEXT,
      platform         TEXT,
      is_live          INTEGER NOT NULL DEFAULT 0,
      requester_id     TEXT,
      -- 대기열 줄 번호(player/track-state 의 entry). 곡을 가리키는 이름표라 옮겨도 그대로다(seq 는 슬롯 안의 차례라 옮기면 바뀐다).
      -- 봇을 다시 켜도 같은 곡이 같은 번호를 지니게 저장한다. 비었으면 복원할 때 새로 받는다
      entry            INTEGER,
      PRIMARY KEY (guild_id, slot, seq)
    );

    -- 봇이 음성 채널 상태에 마지막으로 쓴 값. 재시작 뒤에도 올라와 있는 상태가 우리 것인지 알아본다
    CREATE TABLE IF NOT EXISTS voice_status (
      channel_id  TEXT PRIMARY KEY,
      status      TEXT NOT NULL
    );

    -- 서버당 하나뿐인 현재 재생 패널의 자리. 옛 패널을 치우는 기준(ui/panel-location)
    CREATE TABLE IF NOT EXISTS now_playing_panel (
      guild_id    TEXT PRIMARY KEY,
      channel_id  TEXT,
      message_id  TEXT NOT NULL
    );
  `);
}

/** 봇이 서버에서 나갔다. 그 서버의 실행 상태를 모두 지운다. channelIds: 그 서버의 채널(음성 채널 상태는 채널로 적는다) */
function forgetGuild(guildId: string, channelIds: Iterable<string>) {
  const db = stateDb.get();
  const dropStatus = db.prepare("DELETE FROM voice_status WHERE channel_id = ?");
  db.transaction(() => {
    db.prepare("DELETE FROM player_sessions WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM now_playing_panel WHERE guild_id = ?").run(guildId);
    for (const channelId of channelIds) dropStatus.run(channelId);
  })();
}

export { stateDb, createTables, forgetGuild };
