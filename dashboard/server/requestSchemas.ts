// 대시보드 요청의 모양. 경로가 스스로 400 을 내는 값만 여기서 본다(문장은 그 경로의 것 그대로).
// 재생 조작의 값(볼륨 · 반복 모드 · 대기열 위치)은 규칙과 문장을 usecases/controls 가 쥐고 있어 정수로만 바꿔 넘긴다(toInt).
// 서버에 그 역할 · 채널이 있나처럼 서버를 봐야 아는 것은 경로가 본다.

import { z } from "zod";
import { MAX_COUNT } from "../../src/usecases/playlistMore.ts";
import playerView from "./playerView.ts";
const { QUEUE_WINDOW_MAX } = playerView;

/** 검사 → { ok: true, value } | { ok: false, error: 첫 문제의 문장 } */
function parse<T extends z.ZodType>(schema: T, input: unknown): { ok: true; value: z.output<T> } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: result.error.issues[0].message };
}

// ── 재생 ──

// 구간 이동 { position: 초 }. "Infinity"(라이브 duration 0 에서 클램프를 뚫는다)와 비숫자 문자열은 거부
const BAD_POSITION = { error: "재생 위치가 올바르지 않습니다." };
const SeekBody = z.object({ position: z.coerce.number(BAD_POSITION).min(0, BAD_POSITION) }, BAD_POSITION);

// 대기열 구간 ?offset=&limit=
const BAD_OFFSET = { error: "대기열 시작 위치가 올바르지 않습니다." };
const BAD_LIMIT = { error: "대기열 요청 개수가 올바르지 않습니다." };
const QueueWindowQuery = z.object({
  offset: z.coerce.number(BAD_OFFSET).int(BAD_OFFSET).min(0, BAD_OFFSET),
  limit: z.coerce.number(BAD_LIMIT).int(BAD_LIMIT).positive(BAD_LIMIT).max(QUEUE_WINDOW_MAX, BAD_LIMIT),
});

// 곡 추가 { query, single }. 제어문자(CR/LF/NUL 등)는 공백으로. 로그 위조 · 외부 도구 인자 오염을 막는다
const QUERY_MAX_LEN = 500;
const BAD_QUERY = { error: `검색어를 입력해 주세요 (문자열, 최대 ${QUERY_MAX_LEN}자)` };
const AddBody = z.object(
  {
    query: z
      .string(BAD_QUERY)
      .max(QUERY_MAX_LEN, BAD_QUERY)
      .transform((raw) => raw.replace(/[\x00-\x1f\x7f]/g, " ").trim())
      .pipe(z.string().min(1, BAD_QUERY)),
    single: z
      .unknown()
      .optional()
      .transform((v) => v === true),
  },
  BAD_QUERY,
);

// 재생목록 더 넣기의 곡 수. 목록 상태(validState)는 디스코드 쪽과 같이 쓰는 usecases/playlistMore 가 본다
const MoreCount = z.number().int().min(1).max(MAX_COUNT);

// ── 서버 설정 ──

// 없는 칸은 바꾸지 않는다. null 은 기본값으로 되돌린다(전용 채널 · 재생목록 곡 수). 차례는 문제를 알리는 차례다
function settingsBody({ min, max }: { min: number; max: number }) {
  const BAD_PLAYLIST_ADD = { error: `재생목록 한 번에 넣는 곡 수는 ${min}~${max} 사이의 정수여야 합니다` };
  const BAD_CATEGORIES = { error: "sponsorblock.categories는 문자열 배열이어야 합니다" };
  const BAD_ROLES = { error: "djRoleIds는 역할 ID 문자열 배열이어야 합니다" };
  return z.object(
    {
      playlistAddMax: z.union([z.null(), z.number().int().min(min).max(max)], BAD_PLAYLIST_ADD).optional(),
      sponsorblock: z
        .object(
          {
            // 참 · 거짓이 아니면 바꾸지 않는다
            enabled: z
              .unknown()
              .optional()
              .transform((v) => (typeof v === "boolean" ? v : null)),
            categories: z.array(z.string(BAD_CATEGORIES), BAD_CATEGORIES).optional(),
          },
          { error: "sponsorblock 설정 형식이 올바르지 않습니다" },
        )
        .optional(),
      djRoleIds: z.array(z.string(BAD_ROLES), BAD_ROLES).optional(),
      botChannelId: z.union([z.null(), z.string()], { error: "봇 전용 채널은 일반 텍스트 채널이어야 합니다" }).optional(),
    },
    { error: "서버 설정 형식이 올바르지 않습니다" },
  );
}

const exported = { parse, SeekBody, QueueWindowQuery, AddBody, MoreCount, settingsBody };
export default exported;
export { exported as "module.exports" };
