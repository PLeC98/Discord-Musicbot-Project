// 장르 설정 ↔ 편집 행. 편집 중에는 배열로 다룬다. 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
// 이름이 곧 키다. 따로 id를 두지 않는다.
// 행은 원래 장르를 통째로 들고 있다가(kept) 화면이 고친 칸만 덮어 돌려보낸다. 화면에 칸이 없는 것을 빠뜨리면 저장이 지운다.
// 저장은 보낸 칸의 차례대로 파일을 고쳐 쓰므로 원래 칸의 차례도 지킨다(있던 칸은 제자리, 새로 적은 칸은 끝에).
//
// 장르마다 덮어쓸 수 있는 칸은 셋(최소 · 최대 길이, 차단할 말). 비우면 그 칸을 빼서 전역 값을 쓴다.
// 재생은 { ...defaults, ...장르 } 로 합치므로 장르의 차단할 말은 전역 목록에 더하지 않고 대신한다

/** 소스 하나(genres.yaml 의 그대로). 칸은 소스 종류마다 다르다(schema/genre-sources 의 SPEC). _key 는 편집 중 행을 붙잡아 두는 번호 */
type SourceData = Record<string, unknown> & { type?: string; _key?: number };
/** 장르 하나(genres.yaml 의 그대로). 화면이 모르는 칸도 들고 있다가 그대로 돌려보낸다 */
type GenreData = Record<string, unknown> & { emoji?: string; sources?: SourceData[]; minDurationSec?: number | null; maxDurationSec?: number | null };

/** 편집 행. key 는 화면이 행을 붙잡아 두는 번호 */
type GenreRow = {
  key: number;
  name: string;
  emoji: string;
  sources: SourceData[];
  minDurationSec: number | string | null;
  maxDurationSec: number | string | null;
  kept: GenreData;
};

let serial = 0;
const nextKey = () => ++serial;

/** 장르마다 덮어쓸 수 있는 칸(차단어는 키워드 출처 칸이 덮어쓴다) */
const OVERRIDES = ["minDurationSec", "maxDurationSec"] as const;

const toRows = (genres: Record<string, GenreData> | null | undefined): GenreRow[] =>
  Object.entries(genres || {}).map(([name, g]) => ({
    key: nextKey(),
    name,
    emoji: g.emoji || "",
    sources: (g.sources || []).map((one) => ({ ...one })),
    minDurationSec: g.minDurationSec ?? null,
    maxDurationSec: g.maxDurationSec ?? null,
    kept: g,
  }));

// 새 행. 들고 있을 원래 장르가 없다
const newRow = (): GenreRow => ({ key: nextKey(), name: "", emoji: "", sources: [], minDurationSec: null, maxDurationSec: null, kept: {} });

// _key 는 편집 중 행을 붙잡아 두려고 붙인 것이라 저장할 때는 뺀다
const clean = (one: SourceData): SourceData => Object.fromEntries(Object.entries(one).filter(([k]) => k !== "_key"));

// 덮어쓰기 칸의 값. 비었으면 undefined(그 칸을 뺀다)
function overrideOf(row: GenreRow, key: (typeof OVERRIDES)[number]) {
  const value = row[key];
  return value === null || value === undefined || value === "" ? undefined : value;
}

function toGenre(row: GenreRow): GenreData {
  // 이모지도 비우면 칸을 뺀다(빈 글자를 파일에 적지 않는다)
  const changed: Record<string, unknown> = { emoji: row.emoji || undefined, sources: row.sources.map(clean) };
  for (const key of OVERRIDES) changed[key] = overrideOf(row, key);
  // 있던 칸은 제자리에서 바꾸거나 빼고, 새 칸은 끝에 붙인다
  const out: GenreData = {};
  for (const [key, value] of Object.entries(row.kept)) {
    if (!(key in changed)) out[key] = value;
    else if (changed[key] !== undefined) out[key] = changed[key];
  }
  for (const [key, value] of Object.entries(changed)) if (!(key in out) && value !== undefined) out[key] = value;
  return out;
}

const toMap = (list: GenreRow[]): Record<string, GenreData> => Object.fromEntries(list.map((r) => [r.name.trim(), toGenre(r)]));

export { toRows, toMap, newRow };
export type { SourceData, GenreData, GenreRow };
