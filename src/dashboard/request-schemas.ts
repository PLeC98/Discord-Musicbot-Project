// 대시보드 요청의 모양. 경로가 스스로 400 을 내는 값만 여기서 본다. 오류 메시지에는 문장 대신 문제 코드(rules/problems)를 적는다.
// 재생 조작의 값(볼륨 · 반복 모드 · 대기열 위치)은 규칙과 문장을 usecases/controls 가 쥐고 있어 정수로만 바꿔 넘긴다(toInt).
// 서버에 그 역할 · 채널이 있나처럼 서버를 봐야 아는 것은 경로가 본다.

import { z } from "zod";
import { MAX_COUNT } from "../rules/more-choices.ts";
import { QUEUE_WINDOW_MAX } from "./contract/player.ts";
import { isCode, type Code } from "../rules/problems.ts";
import type { FieldProblem } from "./contract/problem.ts";
import { LOGIN_BG_BLUR_MAX, LOGIN_BG_COVER_MAX, LOGIN_BG_HISTORY_MAX, LOGIN_BG_ID, SEAM_KINDS, SEAM_SECONDS } from "./contract/login-background.ts";

// 필드의 위치를 JSON Pointer 로(빈 위치는 본문 전체)
const pointerOf = (path: PropertyKey[]) => path.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

/** 검사 → { ok: true, value } | { ok: false, code: 첫 문제의 코드, errors: 필드별 문제 }. 코드를 적지 않은 검사에 걸리면 bad-request */
function parse<T extends z.ZodType>(schema: T, input: unknown): { ok: true; value: z.output<T> } | { ok: false; code: Code; errors: FieldProblem[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const errors = result.error.issues.map((issue): FieldProblem => ({ pointer: pointerOf(issue.path), code: isCode(issue.message) ? issue.message : "bad-request" }));
  return { ok: false, code: errors[0].code, errors };
}

// ── 재생 ──

// 대기열 ID(track-state 가 찍는다). 화면은 받은 그대로 돌려보낸다
const BAD_ENTRY = { error: "bad-request" satisfies Code };
const Entry = z.number(BAD_ENTRY).int(BAD_ENTRY).positive(BAD_ENTRY);
// 지금 곡이 이 줄일 때만(넘기기 · 이전 · 하이라이트). 없으면 확인하지 않는다
const OnTrackBody = z.object({ onTrack: Entry.optional() }, BAD_ENTRY);

// 구간 이동 { position: 초, onTrack? }. "Infinity"(라이브 duration 0 에서 클램프를 뚫는다)와 비숫자 문자열은 거부
const BAD_POSITION = { error: "bad-time" satisfies Code };
const SeekBody = z.object({ position: z.coerce.number(BAD_POSITION).min(0, BAD_POSITION), onTrack: Entry.optional() }, BAD_POSITION);

// 대기열 ID로 옮기기 { entry, before }. before 곡 앞으로, null 이면 맨 끝
const MoveEntryBody = z.object({ entry: Entry, before: Entry.nullable() }, BAD_ENTRY);

// 자동재생 { genre }. 장르 이름이면 켜고(바꾸고) null 이면 끈다. 모르는 장르는 코어가 거절한다(unknown-genre)
const BAD_GENRE = { error: "bad-request" satisfies Code };
const AutoplayBody = z.object({ genre: z.string(BAD_GENRE).trim().min(1, BAD_GENRE).max(100, BAD_GENRE).nullable() }, BAD_GENRE);

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

// 없는 필드는 바꾸지 않는다. null 은 기본값으로 되돌린다(전용 채널 · 재생목록 곡 수). 순서는 문제를 알리는 순서다
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

/** 서버 설정 저장의 본문(화면이 보내는 모양) */
type SettingsRequest = z.input<ReturnType<typeof settingsBody>>;

// ── 파비콘 ──

const BAD_FAVICON = { error: "bad-request" satisfies Code };
// 기록의 그림으로 교체 { id }
const FaviconUseBody = z.object({ id: z.string(BAD_FAVICON).min(1, BAD_FAVICON).max(64, BAD_FAVICON) }, BAD_FAVICON);
// 링크로 추가 { url }. http · https 인지 · 내부 주소인지는 infra/safe-url 이 본다
const FaviconLinkBody = z.object({ url: z.string(BAD_FAVICON).trim().min(1, BAD_FAVICON).max(2048, BAD_FAVICON) }, BAD_FAVICON);

// ── 로그인 배경 ──

const BAD_BACKGROUND = { error: "bad-request" satisfies Code };
const bgNumber = (min: number, max: number) => z.number(BAD_BACKGROUND).min(min, BAD_BACKGROUND).max(max, BAD_BACKGROUND);
// 원본에서 쓸 사각형(0 ~ 1). 넓이가 있고 원본 밖으로 나가지 않는다(소수 오차는 봐준다)
const BackgroundCrop = z.object({ x: bgNumber(0, 1), y: bgNumber(0, 1), w: bgNumber(0, 1).positive(BAD_BACKGROUND), h: bgNumber(0, 1).positive(BAD_BACKGROUND) }, BAD_BACKGROUND).refine((crop) => crop.x + crop.w <= 1 + 1e-6 && crop.y + crop.h <= 1 + 1e-6, BAD_BACKGROUND);
// 쓸 구간(초). 1초 이상(영상 길이 안인지는 경로가 본다)
const BackgroundRange = z.tuple([bgNumber(0, Number.MAX_SAFE_INTEGER), bgNumber(0, Number.MAX_SAFE_INTEGER)], BAD_BACKGROUND).refine(([from, to]) => to - from >= 1, BAD_BACKGROUND);
// 편집 적용 { crop, range, thumbAt }. 썸네일 장면은 구간 안
const BackgroundEditBody = z.object({ crop: BackgroundCrop, range: BackgroundRange.nullable(), thumbAt: bgNumber(0, Number.MAX_SAFE_INTEGER).nullable() }, BAD_BACKGROUND).refine((edit) => edit.thumbAt === null || edit.range === null || (edit.thumbAt >= edit.range[0] && edit.thumbAt <= edit.range[1]), BAD_BACKGROUND);
// 크기 어림 다시 세기 { crop, range }
const BackgroundEstimateBody = z.object({ crop: BackgroundCrop, range: BackgroundRange.nullable() }, BAD_BACKGROUND);
// 보일 위치 { x, y }(%)
const BackgroundPositionBody = z.object({ x: bgNumber(0, 100), y: bgNumber(0, 100) }, BAD_BACKGROUND);
// 화면에서 거는 값
const BackgroundOptionsBody = z.object(
  {
    blur: bgNumber(0, LOGIN_BG_BLUR_MAX),
    cover: bgNumber(0, LOGIN_BG_COVER_MAX),
    follow: z.boolean(BAD_BACKGROUND),
    seam: z.object({ kind: z.enum(SEAM_KINDS, BAD_BACKGROUND), seconds: z.literal(SEAM_SECONDS, BAD_BACKGROUND) }, BAD_BACKGROUND),
  },
  BAD_BACKGROUND,
);
// 기록 · 저장 한도 { history, maxBytes }
const BackgroundLimitsBody = z.object({ history: bgNumber(0, LOGIN_BG_HISTORY_MAX).int(BAD_BACKGROUND), maxBytes: bgNumber(0, Number.MAX_SAFE_INTEGER).int(BAD_BACKGROUND) }, BAD_BACKGROUND);
// 기록의 배경으로 교체 { id }
const BackgroundUseBody = z.object({ id: z.string(BAD_BACKGROUND).regex(LOGIN_BG_ID, BAD_BACKGROUND) }, BAD_BACKGROUND);
// 링크로 추가 { url }. 다운로드하는 쪽(safe-url · yt-dlp)이 주소를 본다
const BackgroundLinkBody = z.object({ url: z.string(BAD_BACKGROUND).trim().min(1, BAD_BACKGROUND).max(2048, BAD_BACKGROUND) }, BAD_BACKGROUND);

export { parse, Entry, OnTrackBody, SeekBody, MoveEntryBody, AutoplayBody, QueueWindowQuery, AddBody, MoreCount, settingsBody, FaviconUseBody, FaviconLinkBody, BackgroundEditBody, BackgroundEstimateBody, BackgroundPositionBody, BackgroundOptionsBody, BackgroundLimitsBody, BackgroundUseBody, BackgroundLinkBody, QUERY_MAX_LEN };
export type { SettingsRequest };
