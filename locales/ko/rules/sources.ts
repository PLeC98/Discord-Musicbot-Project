// 자동재생 장르의 소스 종류(config/schema/genre-sources)의 이름과 입력란 글. 소스 편집기, 설정 검사 문장, 디스코드 안내가 같이 쓴다.
// 종류마다 이름(label), 설명(hint), 입력란마다 이름, 설명, 빈 값 이름(emptyLabel). 선택지 이름은 options의 묶음에서 API 값으로 찾는다(없는 값은 API 값 그대로)

import type { SourceText } from "../../../src/rules/text/shape.ts";

// VocaDB 계열(사이트 셋)이 같이 쓰는 입력란. 가수 쪽 이름만 사이트마다 다르다
const VOCA_SCORE_HINT = '해당 사이트의 "評価" 점수.';
const vocaFields = (singer: { typeLabel?: string; artistLabel: string; artistHint: string }) => ({
  tags: { label: "장르 태그", hint: "rock, pop, ballad, EDM, 和風 등. 여럿이면 모두 붙은 곡" },
  minScore: { label: "최소 평가 점수", hint: VOCA_SCORE_HINT },
  languages: { label: "가사 언어", hint: "번역 가사만 있는 곡도 섞여요" },
  ...(singer.typeLabel ? { artistTypes: { label: singer.typeLabel, hint: "여럿 선택하면 모두 참여한 곡" } } : {}),
  artists: { label: singer.artistLabel, hint: singer.artistHint },
  songTypes: { label: "곡 종류" },
  excludeTags: { label: "제외할 태그", hint: "하나라도 붙은 곡은 빼요" },
  minLength: { label: "최소 길이(초)" },
  maxLength: { label: "최대 길이(초)" },
  minBpm: { label: "최소 BPM" },
  maxBpm: { label: "최대 BPM" },
  yearFrom: { label: "해당 연도 이후 발표" },
  yearTo: { label: "해당 연도 이전 발표" },
  sort: { label: "정렬" },
});

const sources = {
  keyword: {
    label: "키워드",
    hint: "지정한 키워드 중 하나를 선택해 유튜브에서 검색해요. 품질이 가장 낮으니 가중치를 낮게 주세요.",
    fields: { keywords: { label: "검색어", hint: "무작위로 하나를 선택해 사용해요" }, blockedKeywords: { label: "제외 키워드 오버라이드", hint: "입력하면 이 출처에서는 전역 제외 키워드 대신 이것을 써요. 비우면 전역 값" } },
  },
  lastfm: {
    label: "Last.fm",
    hint: "태그로 곡 이름을 불러와 유튜브에서 찾아요.",
    fields: { tags: { label: "태그", hint: "태그마다 품질 편차가 커요. 관련 태그를 여럿 입력하는 게 좋아요" }, pages: { label: "불러올 페이지 수" } },
  },
  lbradio: {
    label: "ListenBrainz Radio",
    hint: "태그나 프롬프트로 재생목록을 만들어 줘요. 둘 중 하나는 입력해야 해요.",
    fields: {
      tags: { label: "태그", hint: "MusicBrainz 공식 장르명" },
      mode: { label: "모드", hint: "easy는 덜 알려진 곡, hard는 더 알려진 곡을 줘요. 여럿 선택하면 섞어요" },
      prompt: { label: "프롬프트 직접 작성", hint: "예) tag:(jazz,funk)::or, artist:(Miles Davis)" },
    },
  },
  animethemes: {
    label: "AnimeThemes",
    hint: "애니 주제가 DB. 유튜브에 풀버전이 있으면 그쪽을, 없으면 TV 사이즈 음원을 재생해요.",
    fields: {
      themeType: { label: "주제가 종류", emptyLabel: "OP/ED" },
      sort: { label: "고르는 방식", emptyLabel: "무작위", hint: "인기순은 상위 500곡 중에서" },
      mediaFormat: { label: "매체", hint: "비우면 전부" },
      yearFrom: { label: "방영 연도", hint: "양 끝까지 벌리면 전체" },
      seasonFrom: { label: "시작 분기", emptyLabel: "그 해 처음부터" },
      seasonTo: { label: "끝 분기", emptyLabel: "그 해 끝까지" },
      season: { label: "특정 분기만", hint: "연도와 무관하게 이 분기만" },
      sequence: { label: "몇 번째 주제가", hint: "1이면 OP1, ED1만" },
    },
  },
  anisongdb: {
    label: "AnisongDB",
    hint: "애니 주제가 DB(AMQ 기반). 곡마다 인지도 점수가 있어 유명한 곡만 선택할 수 있어요. 유튜브에 풀버전이 있으면 그쪽을, 없으면 TV 사이즈 음원을 재생해요.",
    fields: {
      difficultyFrom: { label: "인지도", hint: "AMQ에서 그 곡을 맞힌 사람의 비율이에요. 높을수록 유명해요" },
      yearFrom: { label: "방영 연도", hint: "양 끝까지 벌리면 전체" },
      seasonFrom: { label: "시작 분기", emptyLabel: "그 해 처음부터" },
      seasonTo: { label: "끝 분기", emptyLabel: "그 해 끝까지" },
      songTypes: { label: "주제가 종류", hint: "비우면 OP와 ED만. 삽입곡은 폭이 크게 넓어져요" },
      animeTypes: { label: "매체", hint: "비우면 전부" },
      genres: { label: "장르", hint: "선택한 것 중 하나라도 맞으면 나와요" },
      n: { label: "한 번에 불러올 곡 수" },
      songCategories: { label: "곡 성격", hint: "비우면 일반만" },
      broadcasts: { label: "방영 판본", hint: "비우면 본방만. 재방송판에만 있는 곡이 있어요" },
      tags: { label: "태그", hint: "장르보다 잘게 나눈 거예요. 예) School, Idol, Isekai" },
    },
  },
  vocadb: { label: "VocaDB", hint: "보컬로이드 DB.", fields: vocaFields({ typeLabel: "보컬 라이브러리", artistLabel: "특정 보컬만", artistHint: "입력하면 후보가 표시돼요. 예) 初音ミク. 여럿이면 모두 참여한 곡" }) },
  utaitedb: { label: "UtaiteDB", hint: "우타이테 DB", fields: vocaFields({ typeLabel: "가수 분류", artistLabel: "특정 우타이테만", artistHint: "입력하면 후보가 표시돼요. 여럿이면 모두 참여한 곡" }) },
  touhoudb: { label: "TouhouDB", hint: "동방 DB. 동방 어레인지, OST 등이 있어요.", fields: vocaFields({ artistLabel: "특정 아티스트만", artistHint: "입력하면 후보가 표시돼요. 예) ZUN. 여럿이면 모두 참여한 곡" }) },
  spotify: { label: "스포티파이 재생목록", fields: { url: { label: "주소", hint: "재생목록, 앨범, 아티스트" } } },
  youtube: {
    label: "유튜브 재생목록",
    fields: {
      url: {
        label: "주소",
        hint: "일반 재생목록이나 유튜브 뮤직 공식 재생목록(list=RDCLAK…)을 넣어 주세요. 전체 곡 수 안에서 무작위로 곡을 뽑기 때문에, 믹스처럼 유튜브가 끝없이 이어 주는 자동 목록은 쓰지 못해요.",
      },
    },
  },
} satisfies Record<string, SourceText>;

/** 선택지 이름 묶음: API 값 → 보일 이름 */
const options = {
  // 정렬 이름은 저쪽 코드 값이다
  sort: { popular: "인기순", RatingScore: "평가 점수 높은 순", FavoritedTimes: "즐겨찾기 많은 순", PublishDate: "발표 최신순", AdditionDate: "등록 최신순", TagUsageCount: "태그 많은 순", SongType: "곡 종류순", Name: "이름순" },
  season: { Winter: "1분기", Spring: "2분기", Summer: "3분기", Fall: "4분기" },
  anisongSongTypes: { opening: "OP", ending: "ED", insert: "삽입곡" },
  anisongAnimeTypes: { tv: "TV", movie: "극장판", ova: "OVA", ona: "ONA", special: "스페셜", other: "기타" },
  anisongCategories: { standard: "일반", character: "캐릭터송", chanting: "구호, 챈트", instrumental: "연주곡", other: "기타" },
  anisongBroadcasts: { normal: "본방", dub: "더빙", rebroadcast: "재방송" },
  // 가사 언어(ISO 639-1)
  // prettier-ignore
  language: { ja: "일본어", en: "영어", zh: "중국어", ko: "한국어", es: "스페인어", pt: "포르투갈어", fr: "프랑스어", ru: "러시아어", id: "인도네시아어", tl: "타갈로그어", de: "독일어", uk: "우크라이나어", it: "이탈리아어", tr: "튀르키예어", th: "태국어", pl: "폴란드어", vi: "베트남어", nl: "네덜란드어", la: "라틴어", ms: "말레이어", fi: "핀란드어", sr: "세르비아어", sv: "스웨덴어", cs: "체코어", eo: "에스페란토", be: "벨라루스어", ca: "카탈루냐어", ro: "루마니아어", so: "소말리아어", ar: "아랍어", no: "노르웨이어", el: "그리스어", bs: "보스니아어", bg: "불가리아어", he: "히브리어", hi: "힌디어", hu: "헝가리어", kk: "카자흐어", yi: "이디시어", bn: "벵골어", da: "덴마크어", eu: "바스크어", ga: "아일랜드어", mn: "몽골어", ur: "우르두어", cy: "웨일스어", sa: "산스크리트어", sk: "슬로바키아어", ta: "타밀어", tg: "타지크어", zu: "줄루어", et: "에스토니아어", gl: "갈리시아어", my: "버마어", ba: "바시키르어", bo: "티베트어", kn: "칸나다어", oc: "오크어", sw: "스와힐리어", te: "텔루구어" },
};

/** VocaDB 계열 곡 종류의 설명. defaults는 비웠을 때 받는 곡 종류 */
const songTypesHint = (defaults: string) => `기본값: ${defaults}`;

export { sources, options, songTypesHint };
