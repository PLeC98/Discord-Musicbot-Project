"use strict";

// 저장소에서 되읽는 행의 모양. 밖(디스크)에서 들어오는 값이라 트랙으로 바꾸기 전에 한 번 본다.
// 모양이 틀린 행은 버리고 한 줄 남긴다. 한 행 때문에 대기열 전체를 못 되살리면 안 된다.

const { z } = require("zod");
const log = require("../infra/log/logger").child({ category: "cache" });

const text = z.string().min(1);
const maybe = (schema) => schema.nullable();

/** 세션 표의 트랙 한 줄(PersistedTrack). 음원 주소는 스포티파이가 영상을 찾기 전이면 없다 */
const SessionTrackRow = z.object({
  guild_id: text,
  slot: z.enum(["current", "queue", "history"]),
  seq: z.number().int(),
  track_id: maybe(z.string()),
  page_url: text,
  request_key: text,
  audio_url: maybe(text),
  title: maybe(z.string()),
  artist: maybe(z.string()),
  album: maybe(z.string()),
  uploader: maybe(z.string()),
  duration_sec: maybe(z.number()),
  thumbnail: maybe(z.string()),
  platform: maybe(z.string()),
  is_live: z.number().int(),
  requester_id: maybe(z.string()),
  added_at: z.number(),
});

/** 링크 장부 한 줄 */
const LookupRow = z.object({
  request_key: text,
  page_url: text,
  audio_url: text,
  platform: text,
  display_title: maybe(z.string()),
  display_artist: maybe(z.string()),
  display_thumbnail: maybe(z.string()),
  title_verified: z.number().int(),
  created_at: z.number(),
  updated_at: z.number(),
});

/** 맞으면 그 행, 틀리면 null(한 줄 남긴다) */
function checked(schema, row, what) {
  if (!row) return null;
  const result = schema.safeParse(row);
  if (result.success) return result.data;
  const where = result.error.issues.map((i) => i.path.join(".")).join(", ");
  log.warn(`${what} 행의 모양이 틀려 버립니다(${where}): ${row.request_key ?? "?"}`);
  return null;
}

module.exports = { SessionTrackRow, LookupRow, checked };
