// 자동재생 후보를 필터링하는 규칙. 통과 여부뿐 아니라 왜 떨어졌는지를 돌려준다.
// 실제 재생과 실측 도구가 이 코드를 같이 지난다(도구가 규칙을 베끼면 잰 값이 실제와 어긋난다).
// 생김새는 길이 관문 뒤의 안전망이다(상한 안의 믹스는 거의 길이와 제외 키워드가 잡는다).

import { GENRE_DEFAULTS } from "../config/schema/genres.ts";

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[0-9#*]️⃣$/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const PICTURE_BY_DEFAULT = /\p{Emoji_Presentation}/u;

/**
 * 이모지처럼 보이는 글자 묶음인가: 국기, VS16 이 붙은 키캡, 그림 글자를 품고 기본이 그림이거나 VS16 이나 ZWJ 가 붙은 것.
 * VS15(글자 모양 지정)만 붙은 것과 그림 표시가 없는 ©, ™ 은 세지 않는다.
 * 등록된 조합 목록(RGI)을 보지 않아 Node 의 Unicode 판이 낡아도 조합 이모지를 조각마다 더 세지 않는다
 */
function looksEmoji(grapheme: string): boolean {
  if (FLAG.test(grapheme) || KEYCAP.test(grapheme)) return true;
  if (!PICTOGRAPHIC.test(grapheme)) return false;
  if (grapheme.includes("︎") && !grapheme.includes("‍")) return false;
  return PICTURE_BY_DEFAULT.test(grapheme) || grapheme.includes("️") || grapheme.includes("‍");
}

function emojiCount(title: string): number {
  let count = 0;
  for (const { segment } of GRAPHEMES.segment(title)) if (looksEmoji(segment)) count++;
  return count;
}

// 날짜(2024.11.10, 2024-11-10, 11/10/2024) 안의 연도는 세지 않는다. 라이브 한 곡 영상이 공연 날짜를 적는다
const DATE = /\b(?:(?:19|20)\d\d[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d\d)\b/g;
const yearCount = (t: string) => (t.replace(DATE, " ").match(/\b(19|20)\d\d\b/g) || []).length;
// 숫자 사이의 쉼표("1, 2, 3, 4" 같은 곡 이름)는 세지 않는다
const commaCount = (t: string) => (t.replace(/\d\s*,(?=\s*\d)/g, " ").match(/,/g) || []).length;

// 제목이 "여러 곡을 이어 붙인 것"임을 알리는 생김새.
const MIX_SHAPES: Array<[string, (title: string) => boolean]> = [
  ["연도 둘 이상", (t) => yearCount(t) >= 2],
  ["쉼표 셋 이상", (t) => commaCount(t) >= 3], // 아티스트를 나열한 컴필레이션
  // 셋으로 올리면 900초 넘는 모음 대부분을 놓친다
  ["이모지 둘 이상", (t) => emojiCount(t) >= 2],
  ["시간 표기", (t) => /\b\d+\s*hours?\b|\d+\s*시간/i.test(t)],
];

// 이것이 제목에 있으면 위 생김새 규칙을 면제한다. 거의 늘 한 곡이다(공식 뮤직비디오, 가사 영상 제목에는 이모지, 언어 목록이 흔하다).
// official 은 앞뒤가 글자가 아닐 때만(Official髭男dism 은 밴드 이름이다). feat, ft 만 센다. fe?a?t 로 적으면 "fat", "fet" 도 걸린다.
// 가사 영상 표식(lyrics, 가사)은 괄호 안이나 "lyric video" 로만 본다. 글 속의 lyrics 는 모음 제목에도 나온다("… uplifting lyrics … (1 hour)")
const SONG_MARKS = /(?<!\p{L})official(?!\p{L})|公式|\bm\/?v\b|fullmv|[[(（【][^\])）】]*(?:\blyrics?\b|가사)|\blyrics? video\b|\b(?:feat|ft)\b\.?/iu;

// 단어 경계를 쓸 수 있는 제외 키워드인지. 로마자, 숫자, 공백뿐이면 쓴다.
// 한국어, 일본어에는 \b가 뜻대로 동작하지 않으므로 그때는 그냥 포함 여부를 본다.
const ASCII_WORD = /^[a-z0-9 '&.-]+$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 판정에 쓰는 설정. 수 필드는 글자일 수 있다. blockedKeywords 는 이 출처에 거는 제외 키워드(키워드 출처만, autoplay/route 가 선택한다) */
type FilterConfig = { blockedKeywords?: unknown[]; minDurationSec?: unknown; maxDurationSec?: unknown };
type Limits = { minSec: number; maxSec: number; blocked: Array<{ word: string; test: RegExp | null }> };
type Verdict = { ok: boolean; reason?: string; detail?: string };

// 설정에서 판정에 필요한 것만 미리 꺼내 둔다. 후보마다 다시 만들 이유가 없다.
function prepare(cfg: FilterConfig | null | undefined): Limits {
  const blocked: Limits["blocked"] = [];
  for (const raw of cfg?.blockedKeywords || []) {
    // 제목을 소문자로 낮춰 비교하므로 제외 키워드도 낮춰 둔다
    const word = String(raw).trim().toLowerCase();
    if (!word) continue;
    // 단어 경계를 붙여야 "mix"가 "remix"까지 막지 않는다. 설정에 공백을 넣어 두는 것으로는 안 된다
    // (대시보드가 앞뒤 공백을 뗀다).
    blocked.push({ word, test: ASCII_WORD.test(word) ? new RegExp(`\\b${escape(word)}\\b`) : null });
  }

  return {
    minSec: Number(cfg?.minDurationSec ?? GENRE_DEFAULTS.minDurationSec),
    maxSec: cfg?.maxDurationSec == null ? Infinity : Number(cfg.maxDurationSec), // 비우면 상한 없음(GENRE_DEFAULTS)
    blocked,
  };
}

function judge(track: { duration?: number | null; title?: string | null } | null | undefined, limits: Limits): Verdict {
  // 길이를 모르는 것은 대개 라이브다
  if (!track?.duration) return { ok: false, reason: "길이 없음" };
  if (track.duration < limits.minSec) return { ok: false, reason: "너무 짧음" };
  if (track.duration > limits.maxSec) return { ok: false, reason: "너무 긺" };

  const title = (track.title || "").toLowerCase();

  // 제외 키워드는 곡 표식이 있어도 면제하지 않는다. "공식 믹스"도 믹스다
  const blocked = limits.blocked.find((b) => (b.test ? b.test.test(title) : title.includes(b.word)));
  if (blocked) return { ok: false, reason: "제외 키워드", detail: blocked.word };

  if (SONG_MARKS.test(title)) return { ok: true };

  const shape = MIX_SHAPES.find(([, test]) => test(title));
  if (shape) return { ok: false, reason: "믹스 생김새", detail: shape[0] };

  return { ok: true };
}

export { prepare, judge };
export type { FilterConfig, Limits, Verdict };
