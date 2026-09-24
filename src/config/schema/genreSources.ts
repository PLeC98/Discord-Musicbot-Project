// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 장르 설정(genres.yaml)의 소스 줄 규격. 종류마다 칸 · 값 목록 · 필요한 키. 설정 검증과 대시보드 편집기와 자동재생이 같이 본다.

import config from "../../../config.ts";

// 요청은 소문자, 응답은 대문자다. 받은 값을 그대로 되보내면 422.
const ANISONG_SONG_TYPES = ["opening", "ending", "insert"];

const ANISONG_ANIME_TYPES = ["tv", "movie", "ova", "ona", "special", "other"];

const ANISONG_CATEGORIES = ["standard", "character", "chanting", "instrumental", "other"];

const ANISONG_BROADCASTS = ["normal", "dub", "rebroadcast"];

// 설정 검증이 동기라 여기 적어야 한다. 정본은 database_stats이고 화면은 그쪽을 쓴다.
// 태그는 수가 많아 못 적는다. 오타는 저쪽 422로 드러난다.
const ANISONG_GENRES = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

// 기본 곡 종류가 사이트마다 다르다. 셋 다 같은 소프트웨어지만 무엇이 "본체"인지가 다르다.
//   utaitedb. 우타이테는 남의 곡을 부르는 사람들이다. Original로 받으면 정작 우타이테가
//              아니라 보컬로이드 원곡이 온다(MARETU feat. 初音ミク 같은 것).
//   touhoudb. 동방은 어레인지 문화다. Original은 ZUN의 게임 BGM 3,190곡뿐이고,
//              사람들이 듣는 것은 Arrangement 46,557곡 쪽이다(Bad Apple!! · チルノのパーフェクトさんすう教室).
const VOCA_DEFAULT_TYPES = { utaitedb: ["Cover"], touhoudb: ["Arrangement"] };

/**
 * 소스 타입 명세. 설정 검증과 실행이 같은 표를 본다.
 *
 *   label  사람에게 보일 이름(기동 경고 문구에 쓴다)
 *   need   반드시 있어야 하는 값. 안쪽 배열은 "이 중 하나는 있어야 한다"
 *   env    .env에 있어야 하는 이름(없으면 그 소스만 못 쓴다)
 */
// 값이 정해져 있는 칸들. 오타를 설정 시점에 잡는다. 안 그러면 저쪽이 422/400을 돌려주고
// 그 소스가 조용히 빈손이 되어, 설정은 멀쩡한데 그 소스만 안 쓰이는 꼴이 된다.
const SEASONS = ["Winter", "Spring", "Summer", "Fall"];

const MEDIA_FORMATS = ["TV", "TV Short", "Movie", "OVA", "ONA", "Special"];

const LB_MODES = ["easy", "medium", "hard"];

// 정렬 이름은 저쪽 코드값이다. 화면에는 한국어로 보인다. 코드값은 예제 파일 주석으로 충분하다.
const SONG_SORT_OPTIONS = [
  { value: "RatingScore", label: "평가 점수 높은 순" },
  { value: "FavoritedTimes", label: "즐겨찾기 많은 순" },
  { value: "PublishDate", label: "발표 최신순" },
  { value: "AdditionDate", label: "등록 최신순" },
  { value: "TagUsageCount", label: "태그 많은 순" },
  { value: "SongType", label: "곡 종류순" },
  { value: "Name", label: "이름순" },
];

const SONG_SORTS = SONG_SORT_OPTIONS.map((one) => one.value);

// 검사도 사이트별이어야 한다. vocadb 에 Arrangement 를 적으면 0곡이 온다
const vocaEnums = (site) => ({
  songTypes: VOCA_SONG_TYPES[site],
  sort: SONG_SORTS,
  languages: VOCA_LANGUAGES[site].map((one) => one.value),
  ...(VOCA_ARTIST_TYPES[site] ? { artistTypes: VOCA_ARTIST_TYPES[site] } : {}),
});

// 대시보드가 그릴 입력칸. kind 는 화면이 무엇을 띄울지 정한다.
// list(칩) · text · url · number · range(구간 슬라이더) ·
// enum(하나 고르기) · enumList(알약으로 여럿) · enumDrop(드롭다운에서 여럿) ·
// enumSearch(쳐서 찾아 칩으로 여럿. 항목이 수백 개인 칸).
// deep: true 는 "자주 안 쓰는 것"이라 접어 둔다.
// width 는 칸 너비다. 없으면 한 줄을 다 쓴다. narrow(좁은 숫자칸) · half(늘 반 줄) ·
// halfWide(모바일만 한 줄, 그 위로는 반 줄).
// when: "다른칸" 은 그 칸이 채워졌을 때만 나온다.
const f = (key, kind, label, extra = {}) => ({ key, kind, label, ...extra });

// 고를 값이 정해진 칸. 화면에 보일 말이 API 값과 다르면 짝지어 준다.
const opts = (list) => list.map((v) => (typeof v === "string" ? { value: v, label: v } : v));

const SEASON_OPTIONS = opts([
  { value: "Winter", label: "1분기" },
  { value: "Spring", label: "2분기" },
  { value: "Summer", label: "3분기" },
  { value: "Fall", label: "4분기" },
]);

// 사이트마다 있는 것이 다르다. 돌려쓰면 없는 값을 고르게 되고, 그걸 넣으면 0곡이 온다.
// (실측 2026-09-18. 유튜브 PV 있는 곡 기준으로 한 건이라도 있는 것만)
const VOCA_SONG_TYPES = {
  vocadb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "DramaPV", "Other"],
  utaitedb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "Live", "Other"],
  touhoudb: ["Unspecified", "Original", "Remaster", "Cover", "Arrangement", "Rearrangement", "ShortVersion", "Instrumental", "MusicPV", "DramaPV", "Other"],
};

// 부르는 쪽 분류. TouhouDB에는 아예 없다(0명). 동방은 사람이 부르는 어레인지라 그렇다.
// UtaiteDB는 우타이테와 그 밖뿐이고, 보컬 합성 라이브러리 목록은 VocaDB에만 있다.
const VOCA_ARTIST_TYPES = {
  vocadb: ["Vocaloid", "UTAU", "CeVIO", "SynthesizerV", "VOICEVOX", "Voiceroid", "NEUTRINO", "VoiSona", "ACEVirtualSinger", "AIVOICE", "OtherVoiceSynthesizer", "NewType", "OtherVocalist"],
  utaitedb: ["Utaite", "OtherVocalist"],
  touhoudb: null,
};

// 가사 언어. 저쪽이 목록을 안 주므로 ISO 639-1 전체를 훑어 곡이 실제로 있는 것만 남겼다
// (실측 2026-09-18, 유튜브 PV 있는 곡 기준. 사이트마다 다르고, 많은 순서다).
//
// ha·ln·yo·jv 는 뺐다. 표본 20곡이 전부 "로마자 표기" 항목이었다. 하우사어 곡 12,997개가
// 있는 것이 아니라, 로마자 가사에 엉뚱한 코드가 붙어 있는 것이다.
//
// 번역 가사만 있는 곡도 걸린다(영어는 표본의 절반쯤). 그 언어로 부른 곡만 고를 길은 저쪽에 없다.
const LANG_NAMES = {
  ja: "일본어",
  en: "영어",
  zh: "중국어",
  ko: "한국어",
  es: "스페인어",
  pt: "포르투갈어",
  fr: "프랑스어",
  ru: "러시아어",
  id: "인도네시아어",
  tl: "타갈로그어",
  de: "독일어",
  uk: "우크라이나어",
  it: "이탈리아어",
  tr: "튀르키예어",
  th: "태국어",
  pl: "폴란드어",
  vi: "베트남어",
  nl: "네덜란드어",
  la: "라틴어",
  ms: "말레이어",
  fi: "핀란드어",
  sr: "세르비아어",
  sv: "스웨덴어",
  cs: "체코어",
  eo: "에스페란토",
  be: "벨라루스어",
  ca: "카탈루냐어",
  ro: "루마니아어",
  so: "소말리아어",
  ar: "아랍어",
  no: "노르웨이어",
  el: "그리스어",
  bs: "보스니아어",
  bg: "불가리아어",
  he: "히브리어",
  hi: "힌디어",
  hu: "헝가리어",
  kk: "카자흐어",
  yi: "이디시어",
  bn: "벵골어",
  da: "덴마크어",
  eu: "바스크어",
  ga: "아일랜드어",
  mn: "몽골어",
  ur: "우르두어",
  cy: "웨일스어",
  sa: "산스크리트어",
  sk: "슬로바키아어",
  ta: "타밀어",
  tg: "타지크어",
  zu: "줄루어",
  et: "에스토니아어",
  gl: "갈리시아어",
  my: "버마어",
  ba: "바시키르어",
  bo: "티베트어",
  kn: "칸나다어",
  oc: "오크어",
  sw: "스와힐리어",
  te: "텔루구어",
};

const VOCA_LANG_CODES = {
  // prettier-ignore
  vocadb: ["ja","en","zh","ko","es","pt","fr","ru","id","tl","de","uk","it","tr","th","pl","vi","nl","la","ms","fi","sr","sv","cs","eo","be","ca","ro","so","ar","no","el","bs","bg","he","hi","hu","kk","yi","bn","da","eu","ga","mn","ur","cy","sa","sk","ta","tg","zu","et","gl","my","ba","bo","kn","oc","sw","te"],
  // prettier-ignore
  utaitedb: ["ja","en","ru","fr","pt","uk","zh","ko","pl","de","es","id","it","tl","el","vi","tr","bs","la","nl","sv","th"],
  // prettier-ignore
  touhoudb: ["ja","en","de","zh","fr","ko","la","sa","pl","es","ga","el","it","ro","ru","cs","he","id","sv","th","vi"],
};

const VOCA_LANGUAGES = Object.fromEntries(Object.entries(VOCA_LANG_CODES).map(([site, codes]) => [site, codes.map((code) => ({ value: code, label: LANG_NAMES[code] }))]));

const VOCA_SINGER = {
  vocadb: { typeLabel: "보컬 라이브러리", artistLabel: "특정 보컬만", artistHint: "이름으로 적습니다. 예) UNI, 初音ミク" },
  utaitedb: { typeLabel: "가수 분류", artistLabel: "특정 우타이테만", artistHint: "이름으로 적습니다" },
  touhoudb: { artistLabel: "특정 아티스트만", artistHint: "이름으로 적습니다. 예) ZUN, 暁Records" },
};

// 척도는 사이트마다 크게 다르지만(예제 파일의 표 참고) 설명할 말은 같다
const VOCA_SCORE_HINT = '해당 사이트의 "評価" 점수.';

function vocaFields(site) {
  const singer = VOCA_SINGER[site];
  const types = VOCA_ARTIST_TYPES[site];
  return [
    f("tags", "list", "장르 태그", { hint: "rock, pop, ballad, EDM, 和風 등" }),
    f("minScore", "number", "최소 평가 점수", { width: "half", min: 0, hint: VOCA_SCORE_HINT }),
    // 언어마다 따로 받아 섞는다(vocaFamily). 저쪽이 한 번에 하나만 받는다
    f("languages", "enumDrop", "가사 언어", { width: "half", options: VOCA_LANGUAGES[site], hint: "번역 가사만 있는 곡도 섞입니다" }),
    ...(types ? [f("artistTypes", "enumList", singer.typeLabel, { deep: true, options: opts(types) })] : []),
    f("artists", "list", singer.artistLabel, { deep: true, hint: singer.artistHint }),
    f("songTypes", "enumList", "곡 종류", { deep: true, options: opts(VOCA_SONG_TYPES[site]), hint: `기본값: ${(VOCA_DEFAULT_TYPES[site] || ["Original"]).join(", ")}` }),
    f("excludeTags", "list", "제외할 태그", { deep: true }),
    f("minLength", "number", "최소 길이(초)", { deep: true, width: "narrow", min: 0 }),
    f("maxLength", "number", "최대 길이(초)", { deep: true, width: "narrow", min: 0 }),
    f("minBpm", "number", "최소 BPM", { deep: true, width: "narrow", min: 0 }),
    f("maxBpm", "number", "최대 BPM", { deep: true, width: "narrow", min: 0 }),
    f("yearFrom", "number", "해당 연도 이후 발표", { deep: true, width: "narrow" }),
    f("yearTo", "number", "해당 연도 이전 발표", { deep: true, width: "narrow" }),
    f("sort", "enum", "정렬", { deep: true, options: SONG_SORT_OPTIONS }),
  ];
}

const SPEC = {
  keyword: { label: "키워드", hint: "지정한 키워드 중 하나를 뽑아 유튜브에서 검색합니다. 품질이 가장 낮으니 가중치를 낮게 주세요.", need: [["keywords"]], fields: [f("keywords", "list", "검색어", { hint: "무작위로 하나를 뽑아 사용합니다" })] },
  lastfm: {
    label: "Last.fm",
    hint: "태그로 곡 이름을 받아 유튜브에서 찾습니다.",
    need: [["tags"]],
    env: "LASTFM_API_KEY",
    has: () => !!config.sources?.lastfmKey,
    fields: [f("tags", "list", "태그", { hint: "태그마다 품질 편차가 큽니다. 관련 태그를 여럿 적는 것이 좋습니다" }), f("pages", "number", "가져 올 페이지 수", { deep: true, min: 1, hint: "기본 5" })],
  },
  lbradio: {
    label: "ListenBrainz Radio",
    hint: "태그나 프롬프트를 기반으로 플레이리스트를 제공해 줍니다. 둘 중 하나는 적어야 합니다.",
    need: [["tags", "prompt"]],
    enums: { mode: LB_MODES },
    env: "LISTENBRAINZ_TOKEN",
    has: () => !!config.sources?.listenbrainzToken,
    fields: [f("tags", "list", "태그", { hint: "MusicBrainz 공식 장르명" }), f("mode", "enumList", "모드", { options: opts(LB_MODES), hint: "easy가 마이너한 곡을, hard가 유명한 곡을 줍니다. 여럿 고르면 섞습니다" }), f("prompt", "text", "프롬프트 직접 작성", { deep: true, hint: "예) tag:(jazz,funk)::or, artist:(Miles Davis)" })],
  },
  animethemes: {
    label: "AnimeThemes",
    hint: "애니 주제가 DB. 유튜브에 풀버전이 있으면 그쪽을, 없으면 TV 사이즈 음원을 재생합니다.",
    need: [],
    enums: { themeType: ["OP", "ED"], season: SEASONS, seasonFrom: SEASONS, seasonTo: SEASONS, mediaFormat: MEDIA_FORMATS },
    fields: [
      f("themeType", "enum", "주제가 종류", { width: "halfWide", options: opts(["OP", "ED"]), emptyLabel: "OP/ED" }),
      f("mediaFormat", "enumList", "매체", { width: "halfWide", options: opts(MEDIA_FORMATS), hint: "비우면 전부" }),
      // 두 점으로 잡는 구간. 고를 수 있는 범위는 저쪽에 물어 채운다(catalog)
      f("yearFrom", "range", "방영 연도", { to: "yearTo", hint: "양 끝까지 벌리면 전체" }),
      // 분기는 연도를 자른 뒤에나 뜻이 있다. 연도가 전체면 아예 안 보인다
      f("seasonFrom", "enum", "시작 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 처음부터" }),
      f("seasonTo", "enum", "끝 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 끝까지" }),
      f("season", "enumList", "특정 분기만", { deep: true, width: "halfWide", options: SEASON_OPTIONS, hint: "연도와 무관하게 이 분기만" }),
      f("sequence", "number", "몇 번째 주제가", { deep: true, width: "halfWide", min: 1, hint: "1이면 OP1, ED1만" }),
    ],
  },
  anisongdb: {
    label: "AnisongDB",
    hint: "애니 주제가 DB(AMQ 기반). 곡마다 인지도 점수가 있어 유명한 곡만 고를 수 있습니다. 유튜브에 풀버전이 있으면 그쪽을, 없으면 TV 사이즈 음원을 재생합니다.",
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
    fields: [
      // 두 점으로 잡는 구간. 분포는 catalog 가 저쪽에 물어 채운다
      f("difficultyFrom", "range", "인지도", { to: "difficultyTo", min: 1, max: 100, hint: "AMQ에서 그 곡을 맞힌 사람의 비율입니다. 높을수록 유명합니다" }),
      f("songTypes", "enumList", "주제가 종류", {
        width: "halfWide",
        options: opts([
          { value: "opening", label: "OP" },
          { value: "ending", label: "ED" },
          { value: "insert", label: "삽입곡" },
        ]),
        hint: "비우면 OP·ED만. 삽입곡은 폭이 크게 넓어집니다",
      }),
      f("animeTypes", "enumList", "매체", {
        width: "halfWide",
        options: opts([
          { value: "tv", label: "TV" },
          { value: "movie", label: "극장판" },
          { value: "ova", label: "OVA" },
          { value: "ona", label: "ONA" },
          { value: "special", label: "스페셜" },
          { value: "other", label: "기타" },
        ]),
        hint: "비우면 전부",
      }),
      f("genres", "enumDrop", "장르", { width: "halfWide", options: opts(ANISONG_GENRES), hint: "고른 것 중 하나라도 맞으면 나옵니다" }),
      f("tags", "enumSearch", "태그", { deep: true, options: [], hint: "장르보다 잘게 나눈 것입니다. 예) School · Idol · Isekai" }),
      f("yearFrom", "range", "방영 연도", { to: "yearTo", hint: "양 끝까지 벌리면 전체" }),
      f("seasonFrom", "enum", "시작 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 처음부터" }),
      f("seasonTo", "enum", "끝 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 끝까지" }),
      f("songCategories", "enumList", "곡 성격", {
        deep: true,
        width: "halfWide",
        options: opts([
          { value: "standard", label: "일반" },
          { value: "character", label: "캐릭터송" },
          { value: "chanting", label: "구호·창" },
          { value: "instrumental", label: "연주곡" },
          { value: "other", label: "기타" },
        ]),
        hint: "비우면 일반만",
      }),
      f("broadcasts", "enumList", "방영 판본", {
        deep: true,
        width: "halfWide",
        options: opts([
          { value: "normal", label: "본방" },
          { value: "dub", label: "더빙" },
          { value: "rebroadcast", label: "재방송" },
        ]),
        hint: "비우면 본방만. 재방송판에만 있는 곡이 있습니다",
      }),
      f("n", "number", "한 번에 받아 올 곡 수", { deep: true, width: "halfWide", min: 1, max: 500, hint: "기본 100" }),
    ],
  },
  vocadb: { label: "VocaDB", hint: "보컬로이드 DB.", need: [], enums: vocaEnums("vocadb"), fields: vocaFields("vocadb") },
  utaitedb: { label: "UtaiteDB", hint: "우타이테 DB", need: [], enums: vocaEnums("utaitedb"), fields: vocaFields("utaitedb") },
  touhoudb: { label: "TouhouDB", hint: "동방 DB. 동방 어레인지, OST 등이 있습니다.", need: [], enums: vocaEnums("touhoudb"), fields: vocaFields("touhoudb") },
  spotify: { label: "스포티파이 재생목록", need: [["url"]], env: "SPOTIFY_CLIENT_ID", has: () => !!config.spotify?.clientId, fields: [f("url", "url", "주소", { hint: "재생목록·앨범·아티스트" })] },
  youtube: { label: "유튜브 재생목록", need: [["url"]], fields: [f("url", "url", "주소", { hint: "자동 생성 믹스(list=RD…)는 곡 수에 끝이 없어 사용이 불가능합니다" })] },
};

/** 이 타입을 지금 쓸 수 있나. 키가 필요한 소스는 키가 있어야 한다. */
const usable = (type) => (SPEC[type] ? !SPEC[type].has || SPEC[type].has() : false);

/** 이 타입이 무엇을 필요로 하는지(없으면 null). 기동 시 문구를 만들 때 쓴다. */
const needsOf = (type) => (SPEC[type]?.env ? { env: SPEC[type].env, label: SPEC[type].label } : null);

const TYPES = Object.keys(SPEC);

const exported = { SPEC, TYPES, usable, needsOf, opts, ANISONG_SONG_TYPES, ANISONG_ANIME_TYPES, ANISONG_CATEGORIES, ANISONG_BROADCASTS, VOCA_DEFAULT_TYPES };
export default exported;
export { exported as "module.exports" };
