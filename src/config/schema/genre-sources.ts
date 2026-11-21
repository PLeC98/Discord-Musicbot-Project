// 장르 설정의 소스 줄 규격. 종류마다 필드, 값 목록, 필요한 키. 설정 검증과 대시보드 편집기와 자동재생이 같이 본다.
// 이름, 설명, 선택지 이름은 규칙 문구(rules/text/<언어>/sources)에 있다. 여기는 구조만 둔다

import type { Window } from "../../rules/window-depth.ts";
import type { OptionGroup, RuleSource } from "../../rules/text/shape.ts";

// 곡 DB 셋. 같은 소프트웨어라 부르는 법이 같다
type Site = "vocadb" | "utaitedb" | "touhoudb";
/** 선택할 값 하나. value는 API 값, label은 화면에 보일 말 */
type Option = { value: string; label: string };
/** 편집기가 그릴 입력란의 종류(아래 f의 설명) */
type FieldKind = "list" | "text" | "url" | "number" | "range" | "enum" | "enumList" | "enumDrop" | "enumSearch";
/**
 * 입력란 하나. options는 고를 API 값, optionText는 그 이름을 찾을 묶음(없으면 API 값을 그대로 보여 준다),
 * hintDefaults가 있으면 설명은 "비웠을 때 받는 값"(rules/text의 songTypesHint)
 */
type Field = {
  key: string;
  kind: FieldKind;
  // 빈 입력란에 흐리게 보일 값(봇이 쓰는 기본값)
  placeholder?: string;
  deep?: boolean;
  width?: "narrow" | "half" | "halfWide";
  when?: string;
  // range: 끝점을 담는 필드
  to?: string;
  min?: number;
  max?: number;
  options?: string[];
  optionText?: OptionGroup;
  hintDefaults?: string;
  // list: 입력하는 동안 사이트에서 후보를 불러온다(/api/admin/source-suggest). 아무 말이나 적을 수도 있다
  suggest?: "tags" | "artists";
};
/** 소스 한 종류의 규격(아래 SPEC의 설명) */
type SourceSpec = { need: string[][]; enums?: Record<string, string[]>; env?: string; fields: Field[]; window?: Window };

/** 편집기가 그릴 입력란 하나: 규격에 그 언어의 이름, 설명, 빈 값 이름과 선택지 이름을 채운 것 */
type ViewField = Omit<Field, "options" | "optionText" | "hintDefaults"> & { label: string; hint?: string; emptyLabel?: string; options?: Option[] };

/**
 * 편집기가 그릴 소스 한 종류(/api/admin/source-types). 규격에 그 언어의 글, 지금 쓸 수 있는지와 저쪽에 물어 채운 값을 더한다.
 * either는 "둘 중 하나는 적어야 하는" 필드 그룹, 필드의 histogram은 슬라이더 옆에 그릴 분포
 */
type SourceTypeView = {
  type: string;
  label: string;
  hint: string;
  usable: boolean;
  needs: string | null;
  either: string[][];
  fields: Array<ViewField & { required: boolean; histogram?: number[] }>;
  window: Window | null;
};

// VocaDB 계열은 깊은 곳을 저쪽이 못 준다(sources/voca.ts). 가수, 가수 분류를 걸면 더 느려 더 앞쪽에서 선택한다
const VOCA_WINDOW: Window = { depth: 30_000, narrow: ["artists", "artistTypes"], narrowDepth: 2000 };

// 요청은 소문자, 응답은 대문자다. 받은 값을 그대로 되보내면 422.
const ANISONG_SONG_TYPES = ["opening", "ending", "insert"];

const ANISONG_ANIME_TYPES = ["tv", "movie", "ova", "ona", "special", "other"];

const ANISONG_CATEGORIES = ["standard", "character", "chanting", "instrumental", "other"];

const ANISONG_BROADCASTS = ["normal", "dub", "rebroadcast"];

// 설정 검증이 동기라 여기 적어야 한다. 정본은 database_stats이고 화면은 그쪽을 쓴다.
// 태그는 수가 많아 못 적는다. 오타는 저쪽 422로 드러난다.
const ANISONG_GENRES = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

// 기본 곡 종류가 사이트마다 다르다. utaitedb는 Original로 받으면 우타이테가 아니라 보컬로이드 원곡이 오고,
// touhoudb는 Original이 게임 BGM 뿐이라 사람들이 듣는 Arrangement를 받는다.
const VOCA_DEFAULT_TYPES: Partial<Record<Site, string[]>> = { utaitedb: ["Cover"], touhoudb: ["Arrangement"] };

// 값이 정해져 있는 필드들. 오타를 설정 시점에 잡는다. 안 그러면 저쪽이 422/400을 돌려주고
// 그 소스가 조용히 빈손이 되어, 설정은 멀쩡한데 그 소스만 안 쓰이는 상황이 된다.
const SEASONS = ["Winter", "Spring", "Summer", "Fall"];

const MEDIA_FORMATS = ["TV", "TV Short", "Movie", "OVA", "ONA", "Special"];

const LB_MODES = ["easy", "medium", "hard"];

// 정렬은 저쪽 코드 값(이름은 rules/text의 sort 묶음)
const SONG_SORTS = ["RatingScore", "FavoritedTimes", "PublishDate", "AdditionDate", "TagUsageCount", "SongType", "Name"];

// 검사도 사이트별이어야 한다. vocadb에 Arrangement를 적으면 0곡이 온다
const vocaEnums = (site: Site): Record<string, string[]> => ({
  songTypes: VOCA_SONG_TYPES[site],
  sort: SONG_SORTS,
  languages: VOCA_LANG_CODES[site],
  ...(VOCA_ARTIST_TYPES[site] ? { artistTypes: VOCA_ARTIST_TYPES[site] } : {}),
});

// 대시보드가 그릴 입력란. kind는 화면이 무엇을 표시할지 정한다.
// list(칩), text, url, number, range(구간 슬라이더),
// enum(하나 선택), enumList(알약으로 여럿), enumDrop(드롭다운에서 여럿),
// enumSearch(입력해 찾아 칩으로 여럿. 항목이 수백 개인 입력란).
// deep: true는 "자주 안 쓰는 것"이라 접어 둔다.
// width는 입력란 너비다. 없으면 한 줄을 다 쓴다. narrow(좁은 숫자 입력란), half(늘 반 줄),
// halfWide(모바일만 한 줄, 그 위로는 반 줄).
// when: "다른 필드"는 그 입력란이 채워졌을 때만 나온다.
const f = (key: string, kind: FieldKind, extra: Omit<Field, "key" | "kind"> = {}): Field => ({ key, kind, ...extra });

/** 이름이 따로 없는 선택지(API 값을 그대로 보여 준다) */
const opts = (list: string[]): Option[] => list.map((value) => ({ value, label: value }));

// 사이트마다 있는 것이 다르다. 돌려쓰면 없는 값을 선택하게 되고, 그걸 넣으면 0곡이 온다.
// (유튜브 PV가 있는 곡이 한 곡이라도 있는 것만)
const VOCA_SONG_TYPES: Record<Site, string[]> = {
  vocadb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "DramaPV", "Other"],
  utaitedb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "Live", "Other"],
  touhoudb: ["Unspecified", "Original", "Remaster", "Cover", "Arrangement", "Rearrangement", "ShortVersion", "Instrumental", "MusicPV", "DramaPV", "Other"],
};

// 보컬 종류(artistType). TouhouDB에는 아예 없다(0명). 동방은 사람이 부르는 어레인지라 그렇다.
// UtaiteDB는 우타이테와 그 밖뿐이고, 보컬 합성 라이브러리 목록은 VocaDB에만 있다.
const VOCA_ARTIST_TYPES: Record<Site, string[] | null> = {
  vocadb: ["Vocaloid", "UTAU", "CeVIO", "SynthesizerV", "VOICEVOX", "Voiceroid", "NEUTRINO", "VoiSona", "ACEVirtualSinger", "AIVOICE", "OtherVoiceSynthesizer", "NewType", "OtherVocalist"],
  utaitedb: ["Utaite", "OtherVocalist"],
  touhoudb: null,
};

// 가사 언어. 곡이 실제로 있는 ISO 639-1 코드만 둔다(유튜브 PV가 있는 곡 기준, 사이트마다 많은 순서). 저쪽이 목록을 주지 않는다.
// ha, ln, yo, jv는 로마자 가사에 엉뚱하게 붙는 코드라 뺀다. 번역 가사만 있는 곡도 걸린다(그 언어로 부른 곡만 고를 방법이 저쪽에 없다).
const VOCA_LANG_CODES: Record<Site, string[]> = {
  // prettier-ignore
  vocadb: ["ja","en","zh","ko","es","pt","fr","ru","id","tl","de","uk","it","tr","th","pl","vi","nl","la","ms","fi","sr","sv","cs","eo","be","ca","ro","so","ar","no","el","bs","bg","he","hi","hu","kk","yi","bn","da","eu","ga","mn","ur","cy","sa","sk","ta","tg","zu","et","gl","my","ba","bo","kn","oc","sw","te"],
  // prettier-ignore
  utaitedb: ["ja","en","ru","fr","pt","uk","zh","ko","pl","de","es","id","it","tl","el","vi","tr","bs","la","nl","sv","th"],
  // prettier-ignore
  touhoudb: ["ja","en","de","zh","fr","ko","la","sa","pl","es","ga","el","it","ro","ru","cs","he","id","sv","th","vi"],
};

function vocaFields(site: Site): Field[] {
  const types = VOCA_ARTIST_TYPES[site];
  return [
    f("tags", "list", { suggest: "tags" }),
    f("minScore", "number", { width: "half", min: 0 }),
    // 언어마다 따로 불러와 섞는다(vocaFamily). 저쪽이 한 번에 하나만 받는다
    f("languages", "enumDrop", { width: "half", options: VOCA_LANG_CODES[site], optionText: "language" }),
    ...(types ? [f("artistTypes", "enumList", { deep: true, options: types })] : []),
    f("artists", "list", { deep: true, suggest: "artists" }),
    f("songTypes", "enumList", { deep: true, options: VOCA_SONG_TYPES[site], hintDefaults: (VOCA_DEFAULT_TYPES[site] || ["Original"]).join(", ") }),
    f("excludeTags", "list", { deep: true, suggest: "tags" }),
    f("minLength", "number", { deep: true, width: "narrow", min: 0 }),
    f("maxLength", "number", { deep: true, width: "narrow", min: 0 }),
    f("minBpm", "number", { deep: true, width: "narrow", min: 0 }),
    f("maxBpm", "number", { deep: true, width: "narrow", min: 0 }),
    f("yearFrom", "number", { deep: true, width: "narrow" }),
    f("yearTo", "number", { deep: true, width: "narrow" }),
    f("sort", "enum", { deep: true, options: SONG_SORTS, optionText: "sort" }),
  ];
}

/**
 * 소스 타입 명세. 설정 검증과 실행이 같은 표를 본다.
 *
 *   need   반드시 있어야 하는 값. 안쪽 배열은 "이 중 하나는 있어야 한다"
 *   env    있어야 하는 키의 이름(운영자 패널의 API 키 탭에서 입력한다. 없으면 그 소스만 못 쓴다, config/source-keys)
 */
const SPEC: Record<string, SourceSpec> = {
  keyword: { need: [["keywords"]], fields: [f("keywords", "list"), f("blockedKeywords", "list", { deep: true })] },
  lastfm: {
    need: [["tags"]],
    env: "LASTFM_API_KEY",
    fields: [f("tags", "list"), f("pages", "number", { deep: true, min: 1, placeholder: "5" })],
  },
  lbradio: {
    need: [["tags", "prompt"]],
    enums: { mode: LB_MODES },
    env: "LISTENBRAINZ_TOKEN",
    fields: [f("tags", "list"), f("mode", "enumList", { options: LB_MODES }), f("prompt", "text", { deep: true })],
  },
  animethemes: {
    need: [],
    enums: { themeType: ["OP", "ED"], season: SEASONS, seasonFrom: SEASONS, seasonTo: SEASONS, mediaFormat: MEDIA_FORMATS },
    fields: [
      f("themeType", "enum", { width: "halfWide", options: ["OP", "ED"] }),
      f("mediaFormat", "enumList", { width: "halfWide", options: MEDIA_FORMATS }),
      // 두 점으로 잡는 구간. 선택할 수 있는 범위는 저쪽에 물어 채운다(catalog)
      f("yearFrom", "range", { to: "yearTo" }),
      // 분기는 연도를 자른 뒤에나 뜻이 있다. 연도가 전체면 아예 안 보인다
      f("seasonFrom", "enum", { width: "half", when: "yearFrom", options: SEASONS, optionText: "season" }),
      f("seasonTo", "enum", { width: "half", when: "yearFrom", options: SEASONS, optionText: "season" }),
      f("season", "enumList", { deep: true, width: "halfWide", options: SEASONS, optionText: "season" }),
      f("sequence", "number", { deep: true, width: "halfWide", min: 1 }),
    ],
  },
  anisongdb: {
    need: [],
    // 태그는 364개라 여기 못 적는다(검증이 동기다). 오타는 저쪽 422로 드러난다.
    enums: {
      songTypes: ANISONG_SONG_TYPES,
      animeTypes: ANISONG_ANIME_TYPES,
      songCategories: ANISONG_CATEGORIES,
      broadcasts: ANISONG_BROADCASTS,
      genres: ANISONG_GENRES,
      seasonFrom: SEASONS,
      seasonTo: SEASONS,
    },
    // 필드 순서와 너비가 편집기의 배치다. 상세(deep) 필드는 짝이 되는 기본 필드 옆이나 아래에 둔다
    fields: [
      // 두 점으로 잡는 구간. 분포는 catalog가 저쪽에 물어 채운다
      f("difficultyFrom", "range", { to: "difficultyTo", min: 1, max: 100 }),
      f("yearFrom", "range", { to: "yearTo" }),
      f("seasonFrom", "enum", { width: "half", when: "yearFrom", options: SEASONS, optionText: "season" }),
      f("seasonTo", "enum", { width: "half", when: "yearFrom", options: SEASONS, optionText: "season" }),
      f("songTypes", "enumList", { width: "halfWide", options: ANISONG_SONG_TYPES, optionText: "anisongSongTypes" }),
      f("animeTypes", "enumList", { width: "halfWide", options: ANISONG_ANIME_TYPES, optionText: "anisongAnimeTypes" }),
      f("genres", "enumDrop", { width: "halfWide", options: ANISONG_GENRES }),
      f("n", "number", { deep: true, width: "halfWide", min: 1, max: 500, placeholder: "100" }),
      f("songCategories", "enumList", { deep: true, width: "halfWide", options: ANISONG_CATEGORIES, optionText: "anisongCategories" }),
      f("broadcasts", "enumList", { deep: true, width: "halfWide", options: ANISONG_BROADCASTS, optionText: "anisongBroadcasts" }),
      f("tags", "enumSearch", { deep: true, options: [] }),
    ],
  },
  vocadb: { need: [], enums: vocaEnums("vocadb"), fields: vocaFields("vocadb"), window: VOCA_WINDOW },
  utaitedb: { need: [], enums: vocaEnums("utaitedb"), fields: vocaFields("utaitedb"), window: VOCA_WINDOW },
  touhoudb: { need: [], enums: vocaEnums("touhoudb"), fields: vocaFields("touhoudb"), window: VOCA_WINDOW },
  // 재생목록, 아티스트는 키 없이 돈다(익명 경로). 키가 없는데 앨범을 적으면 그 소스만 빈손이 되고 이유가 경고로 남는다
  spotify: { need: [["url"]], fields: [f("url", "url")] },
  youtube: { need: [["url"]], fields: [f("url", "url")] },
};

/** 이 타입이 어느 키를 필요로 하는지(없으면 null) */
const needsOf = (type: string): { env: string } | null => (SPEC[type]?.env ? { env: SPEC[type].env } : null);

const TYPES = Object.keys(SPEC);

/** 소스 종류의 이름(그 언어). 모르는 종류면 종류 이름 그대로 */
const sourceLabel = (text: RuleSource, type: string) => text.sources[type]?.label ?? type;

/** 입력란 하나에 그 언어의 글과 선택지 이름을 채운다 */
function viewField(text: RuleSource, type: string, field: Field): ViewField {
  const { options, optionText, hintDefaults, ...rest } = field;
  const own = text.sources[type]?.fields[field.key];
  const names = optionText ? text.options[optionText] : {};
  return {
    ...rest,
    label: own?.label ?? field.key,
    ...(hintDefaults !== undefined ? { hint: text.songTypesHint(hintDefaults) } : own?.hint ? { hint: own.hint } : {}),
    ...(own?.emptyLabel ? { emptyLabel: own.emptyLabel } : {}),
    ...(options ? { options: options.map((value) => ({ value, label: names[value] ?? value })) } : {}),
  };
}

export { SPEC, TYPES, needsOf, opts, sourceLabel, viewField, ANISONG_SONG_TYPES, ANISONG_ANIME_TYPES, ANISONG_CATEGORIES, ANISONG_BROADCASTS, VOCA_DEFAULT_TYPES, VOCA_ARTIST_TYPES, VOCA_WINDOW };
export type { Site, Option, FieldKind, Field, ViewField, SourceSpec, SourceTypeView, Window };
