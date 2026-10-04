// 대시보드 요청의 모양. 경로가 스스로 400 을 내는 값만 여기서 본다. 오류 자리에는 문장 대신 문제 코드(rules/problems)를 적는다.
// 재생 조작의 값(볼륨 · 반복 모드 · 대기열 위치)은 규칙과 문장을 usecases/controls 가 쥐고 있어 정수로만 바꿔 넘긴다(toInt).
// 서버에 그 역할 · 채널이 있나처럼 서버를 봐야 아는 것은 경로가 본다.

import { z } from "zod";
import { MAX_COUNT } from "../rules/more-choices.ts";
import { QUEUE_WINDOW_MAX } from "./player-view.ts";
import { isCode, type Code } from "../rules/problems.ts";
import type { FieldProblem } from "./problem.ts";

// 칸의 자리를 JSON Pointer 로(빈 자리는 본문 전체)
const pointerOf = (path: PropertyKey[]) => path.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

/** 검사 → { ok: true, value } | { ok: false, code: 첫 문제의 코드, errors: 칸별 문제 }. 코드를 적지 않은 검사에 걸리면 bad-request */
function parse<T extends z.ZodType>(schema: T, input: unknown): { ok: true; value: z.output<T> } | { ok: false; code: Code; errors: FieldProblem[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const errors = result.error.issues.map((issue): FieldProblem => ({ pointer: pointerOf(issue.path), code: isCode(issue.message) ? issue.message : "bad-request" }));
  return { ok: false, code: errors[0].code, errors };
}

// ── 재생 ──

// 대기열 줄 번호(track-state 가 찍는다). 화면은 받은 그대로 돌려보낸다
const BAD_ENTRY = { error: "bad-request" satisfies Code };
const Entry = z.number(BAD_ENTRY).int(BAD_ENTRY).positive(BAD_ENTRY);
// 지금 곡이 이 줄일 때만(넘기기 · 이전 · 하이라이트). 없으면 확인하지 않는다
const OnTrackBody = z.object({ onTrack: Entry.optional() }, BAD_ENTRY);

// 구간 이동 { position: 초, onTrack? }. "Infinity"(라이브 duration 0 에서 클램프를 뚫는다)와 비숫자 문자열은 거부
const BAD_POSITION = { error: "bad-time" satisfies Code };
const SeekBody = z.object({ position: z.coerce.number(BAD_POSITION).min(0, BAD_POSITION), onTrack: Entry.optional() }, BAD_POSITION);

// 줄 번호로 옮기기 { entry, before }. before 줄 앞으로, null 이면 맨 끝
const MoveEntryBody = z.object({ entry: Entry, before: Entry.nullable() }, BAD_ENTRY);

// 대기열 구간 ?offset=&limit=
const BAD_OFFSET = { error: "bad-queue-range" satisfies Code };
const BAD_LIMIT = BAD_OFFSET;
const QueueWindowQuery = z.object({
  offset: z.coerce.number(BAD_OFFSET).int(BAD_OFFSET).min(0, BAD_OFFSET),
  limit: z.coerce.number(BAD_LIMIT).int(BAD_LIMIT).positive(BAD_LIMIT).max(QUEUE_WINDOW_MAX, BAD_LIMIT),
});

// 곡 추가 { query, single }. 제어문자(CR/LF/NUL 등)는 공백으로. 로그 위조 · 외부 도구 인자 오염을 막는다
const QUERY_MAX_LEN = 500;
const BAD_QUERY = { error: "bad-query" satisfies Code };
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

// 재생목록 더 넣기의 곡 수. 목록 상태(validState)는 디스코드 쪽과 같이 쓰는 usecases/playlist-more 가 본다
const MoreCount = z.number().int().min(1).max(MAX_COUNT);

// ── 서버 설정 ──

// 없는 칸은 바꾸지 않는다. null 은 기본값으로 되돌린다(전용 채널 · 재생목록 곡 수). 차례는 문제를 알리는 차례다
function settingsBody({ min, max }: { min: number; max: number }) {
  const BAD_PLAYLIST_ADD = { error: "playlist-limit-out-of-range" satisfies Code };
  const BAD_CATEGORIES = { error: "bad-sponsor-categories" satisfies Code };
  const BAD_ROLES = { error: "bad-dj-roles" satisfies Code };
  return z.object(
    {
      playlistAddMax: z.union([z.null(), z.number(BAD_PLAYLIST_ADD).int(BAD_PLAYLIST_ADD).min(min, BAD_PLAYLIST_ADD).max(max, BAD_PLAYLIST_ADD)], BAD_PLAYLIST_ADD).optional(),
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
          { error: "bad-sponsorblock" satisfies Code },
        )
        .optional(),
      djRoleIds: z.array(z.string(BAD_ROLES), BAD_ROLES).optional(),
      botChannelId: z.union([z.null(), z.string()], { error: "bad-bot-channel" satisfies Code }).optional(),
    },
    { error: "bad-settings" satisfies Code },
  );
}

export { parse, Entry, OnTrackBody, SeekBody, MoveEntryBody, QueueWindowQuery, AddBody, MoreCount, settingsBody, QUERY_MAX_LEN };
