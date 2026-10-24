// 자동재생 장르 기본값. settings.db 에 "genres" 문서가 없을 때(새로 설치 · 삭제) 이것으로 시작한다(config/documents).
// 필드의 뜻은 대시보드 자동재생 탭의 툴팁 · README 에 있다. 검사는 config/schema/genres(테스트가 이 값이 검사를 지나는지 본다)

const genresDefault: Record<string, unknown> = {
  defaults: {
    prefetchCount: 1,
    minDurationSec: 60,
    maxDurationSec: 3600,
    blockedKeywords: ["best of", "tutorial", "lesson", "course", "learn", "learning", "podcast", "interview", "speech", "lecture", "review", "unboxing", "reaction", "gameplay", "full movie", "full album", "full episode", "documentary", "how to", "guide", "tips", "tricks", "vlog", "practice", "exercise", "workout", "meditation", "asmr", "audiobook", "compilation", "mix", "メドレー", "ランキング", "top hits", "playlist", "mega hits", "billboard top", "플레이리스트", "메들리", "믹스셋", "mixset"],
  },
  genres: {
    pop: {
      label: "팝",
      emoji: "🎤",
      sources: [
        {
          type: "lbradio",
          tags: ["pop"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["pop", "dance pop"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best pop music", "pop hits official"],
        },
      ],
    },
    rock: {
      label: "록",
      emoji: "🎸",
      sources: [
        {
          type: "lbradio",
          tags: ["rock", "classic rock"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["rock", "classic rock", "alternative rock"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best rock music", "classic rock hits"],
        },
      ],
    },
    "hip-hop": {
      label: "힙합",
      emoji: "🎧",
      sources: [
        {
          type: "lbradio",
          tags: ["hip hop", "rap"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["hip hop", "rap"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best rap music", "hip hop music"],
        },
      ],
    },
    electronic: {
      label: "일렉트로닉",
      emoji: "🎛️",
      sources: [
        {
          type: "lbradio",
          tags: ["electronic", "techno"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["electronic", "edm", "techno"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best edm", "electronic dance music"],
        },
      ],
    },
    jazz: {
      label: "재즈",
      emoji: "🎷",
      sources: [
        {
          type: "lbradio",
          tags: ["jazz", "bebop"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["jazz", "bebop"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best jazz", "jazz standards"],
        },
      ],
    },
    classical: {
      label: "클래식",
      emoji: "🎻",
      sources: [
        {
          type: "lbradio",
          tags: ["classical"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["classical", "classical music"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best classical", "classical piano"],
        },
      ],
    },
    metal: {
      label: "메탈",
      emoji: "🤘",
      sources: [
        {
          type: "lbradio",
          tags: ["metal", "heavy metal"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["metal", "death metal"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best metal", "heavy metal songs"],
        },
      ],
    },
    country: {
      label: "컨트리",
      emoji: "🤠",
      sources: [
        {
          type: "lbradio",
          tags: ["country"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["country", "bluegrass"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best country music", "country music official"],
        },
      ],
    },
    rnb: {
      label: "R&B",
      emoji: "💃",
      sources: [
        {
          type: "lbradio",
          tags: ["rnb", "soul"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["rnb", "soul"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best rnb", "soul music"],
        },
      ],
    },
    indie: {
      label: "인디",
      emoji: "🌿",
      sources: [
        {
          type: "lbradio",
          tags: ["indie", "indie rock"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["indie", "indie rock", "indie pop"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best indie", "indie music official"],
        },
      ],
    },
    "k-pop": {
      label: "K-POP",
      emoji: "🇰🇷",
      sources: [
        {
          type: "lbradio",
          tags: ["k-pop"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["k-pop", "korean"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["best kpop", "kpop official mv"],
        },
      ],
    },
    anime: {
      label: "애니",
      emoji: "🎌",
      sources: [
        {
          type: "anisongdb",
          difficultyFrom: 35,
          weight: 3,
        },
        {
          type: "animethemes",
          weight: 2,
        },
        {
          type: "lbradio",
          tags: ["anime"],
          weight: 2,
        },
        {
          type: "lastfm",
          tags: ["anime", "j-pop", "japanese"],
        },
        {
          type: "keyword",
          keywords: ["アニソン 公式", "アニメ オープニング 公式"],
        },
      ],
    },
    vocaloid: {
      label: "보컬로이드",
      emoji: "🎹",
      sources: [
        {
          type: "vocadb",
          minScore: 50,
        },
      ],
    },
    touhou: {
      label: "동방",
      emoji: "⛩️",
      sources: [
        {
          type: "touhoudb",
          minScore: 5,
        },
      ],
    },
    "lo-fi": {
      label: "로파이",
      emoji: "🌙",
      sources: [
        {
          type: "lastfm",
          tags: ["lofi hip hop", "chillhop"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["lofi hip hop music", "lofi beats official"],
        },
      ],
    },
    random: {
      label: "랜덤",
      emoji: "🎲",
      sources: [
        {
          type: "lbradio",
          tags: ["pop", "rock", "electronic", "hip hop"],
          weight: 3,
        },
        {
          type: "lastfm",
          tags: ["pop", "rock", "electronic"],
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["music official video", "top songs 2026"],
        },
      ],
    },
  },
};

export default genresDefault;
