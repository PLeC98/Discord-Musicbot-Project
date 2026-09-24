// yt-dlp JSON 경계. 쓰는 칸만 뽑고 나머지는 흘려보낸다.
// 칸 하나의 모양이 바뀌면(yt-dlp 가 칸을 바꾸면) 그 칸만 버리고 한 번 알린다. 곡 하나를 통째로 버리지 않는다.

import { z } from "zod";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });

const reported = new Set<string>();

function field<T extends z.ZodType>(name: string, schema: T) {
  return schema.nullish().catch((ctx: { input: unknown }) => {
    if (!reported.has(name)) {
      reported.add(name);
      log.warn(`yt-dlp 응답의 ${name} 칸 모양이 바뀌었습니다(받은 값: ${typeof ctx.input}). 이 칸 없이 계속합니다`);
    }
    return undefined;
  });
}

const str = z.string();
const num = z.number();

const SHAPE = {
  // 무엇인가
  id: z.union([str, num]),
  ie_key: str,
  extractor: str,
  extractor_key: str,
  webpage_url: str,
  url: str,
  // 보여 줄 것
  title: str,
  fulltitle: str,
  uploader: str,
  uploader_id: str,
  channel: str,
  channel_id: z.union([str, num]),
  artist: str,
  description: str,
  upload_date: str,
  thumbnail: str,
  thumbnails: z.array(z.object({ url: str.optional() }).loose()),
  view_count: num,
  like_count: num,
  duration: num,
  modified_timestamp: num,
  // 라이브
  is_live: z.boolean(),
  live_status: str,
  // 스트림
  protocol: str,
  format: str,
  format_id: str,
  acodec: str,
  abr: num,
  tbr: num,
  http_headers: z.record(str, str),
  formats: z.array(z.unknown()),
  // 여러 곡(항목은 부르는 쪽이 하나씩 다시 읽는다)
  entries: z.array(z.unknown()),
  playlist_count: num,
  playlist_title: str,
  playlist_uploader: str,
};

const Info = z.object(Object.fromEntries(Object.entries(SHAPE).map(([name, schema]) => [name, field(name, schema)])));

/** yt-dlp 가 준 정보에서 쓰는 칸. 모양이 틀린 칸은 없다(null 은 yt-dlp 가 준 그대로) */
type YtInfo = { [K in keyof typeof SHAPE]?: z.infer<(typeof SHAPE)[K]> | null };

/** yt-dlp 가 준 객체 → 쓰는 칸만 든 객체. 객체가 아니면 null */
function readInfo(raw: unknown): YtInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = Info.parse(raw);
  // 없던 칸은 없는 채로 둔다(undefined 칸을 만들지 않는다)
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as YtInfo;
}

export { readInfo };
export type { YtInfo };
