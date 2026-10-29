// 자동재생 장르 기본값. settings.db 에 "genres" 문서가 없을 때(새로 설치 · 삭제) 이것으로 시작한다(config/documents).
// 필드의 뜻은 대시보드 자동재생 탭의 툴팁 · README 에 있다. 검사는 config/schema/genres(테스트가 이 값이 검사를 지나는지 본다)
// 스포티파이는 공식 재생목록(37i9dQZF1D…)을 쓴다. EDM 의 예전 히트만 공식 목록이 없어 사용자 목록이다.
// 목록이 사라지면 그 출처만 고를 때마다 경고를 남기고 다음 출처로 넘어간다(autoplay/route)

const genresDefault: Record<string, unknown> = {
  defaults: {
    prefetchCount: 1,
    minDurationSec: 60,
    maxDurationSec: 900,
    blockedKeywords: ["reaction", "tutorial", "lesson", "how to", "review", "unboxing", "interview", "podcast", "asmr", "teaser", "trailer", "karaoke", "nightcore", "sped up", "slowed", "8d audio", "non-credit", "creditless", "tv size", "medley", "megamix", "nonstop", "dj mix", "mixset", "playlist", "full album", "compilation", "ノンクレジット", "ノンテロップ", "TVサイズ", "メドレー", "カラオケ", "作業用", "메들리", "노래방", "플레이리스트", "노래모음", "모음집"],
  },
  genres: {
    "k-pop": {
      label: "K-POP",
      emoji: "🫰",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWT9uTRZAYj0c",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX9tPFwDMOaN1",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX14fiWYoe7Oh",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX4winw66sZTE",
          weight: 2,
        },
        {
          type: "lastfm",
          tags: ["k-pop"],
          weight: 1,
        },
        {
          type: "lbradio",
          tags: ["k-pop"],
          mode: "hard",
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["K-POP Official MV"],
          weight: 1,
        },
      ],
    },
    ballad: {
      label: "발라드",
      emoji: "🌧️",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX5LEXW9eXA0n",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX4bUiDosd2wg",
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["발라드 MV"],
          weight: 2,
        },
      ],
    },
    pop: {
      label: "팝",
      emoji: "🎤",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX8j2fTnASZ3f",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX0s5kDXi1oC5",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX7iB3RCnBnN4",
          weight: 1,
        },
        {
          type: "lastfm",
          tags: ["pop"],
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["팝송 Official Music Video"],
          weight: 1,
        },
      ],
    },
    "j-pop": {
      label: "J-POP",
      emoji: "🗼",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXafb0IuPwJyF",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX9ww9tisjowN",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXdbRLJPSmnyq",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWYQelb54GZmT",
          weight: 2,
        },
        {
          type: "lbradio",
          tags: ["j-pop"],
          mode: "hard",
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["J-POP MV 公式"],
          weight: 1,
        },
      ],
    },
    anime: {
      label: "애니",
      emoji: "🎌",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX0hAXqBDwvwI",
          weight: 2,
        },
        {
          type: "anisongdb",
          yearFrom: 2000,
          yearTo: 2022,
          difficultyFrom: 60,
          weight: 2,
        },
        {
          type: "anisongdb",
          yearFrom: 2023,
          difficultyFrom: 50,
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX3f3gm9VK7fL",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWYzHfIcEruXw",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWZZu9JWZK2dy",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXanOaZVFiwtB",
          weight: 1,
        },
        {
          type: "youtube",
          url: "https://www.youtube.com/playlist?list=RDCLAK5uy_nPxXg1gYFA4ZfQ0ke7N8ONHUPg5Ovr7AU",
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["TVアニメ 主題歌 Music Video"],
          weight: 1,
        },
      ],
    },
    vocaloid: {
      label: "보컬로이드",
      emoji: "🎹",
      sources: [
        {
          type: "vocadb",
          minScore: 300,
          weight: 2,
        },
        {
          type: "vocadb",
          yearFrom: 2023,
          minScore: 150,
          weight: 2,
        },
        {
          type: "youtube",
          url: "https://www.youtube.com/playlist?list=RDCLAK5uy_mgu07-HoqLSU-WqjK2ldEQWLuPPm3CAy8",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWZipvLjDtZYe",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXd8cPo2t5Hqf",
          weight: 1,
        },
        {
          type: "utaitedb",
          minScore: 10,
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["初音ミク オリジナル曲 MV"],
          weight: 1,
        },
      ],
    },
    touhou: {
      label: "동방",
      emoji: "⛩️",
      sources: [
        {
          type: "touhoudb",
          minScore: 20,
          weight: 2,
        },
        {
          type: "touhoudb",
          minScore: 10,
          weight: 2,
        },
        {
          type: "touhoudb",
          yearFrom: 2023,
          minScore: 5,
          weight: 1,
        },
      ],
    },
    "hip-hop": {
      label: "힙합",
      emoji: "🎧",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWW46Vfs1oltB",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWZiWafrEIdA8",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWVA1Gq4XHa6U",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX186v583rmzp",
          weight: 1,
        },
        {
          type: "lastfm",
          tags: ["hip-hop"],
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["hip hop official music video"],
          weight: 1,
        },
      ],
    },
    rnb: {
      label: "R&B",
      emoji: "🌙",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXbirtHQBuwCo",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXe4qmDjDW0Ug",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX4SBhb3fqCJd",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWXbttAJcbphz",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWYmmr74INQlb",
          weight: 1,
        },
        {
          type: "lastfm",
          tags: ["rnb"],
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["R&B official music video"],
          weight: 1,
        },
      ],
    },
    ost: {
      label: "OST",
      emoji: "🎬",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX2ohL85TE8TI",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWUXxc8Mc6MmJ",
          weight: 2,
        },
        {
          type: "keyword",
          keywords: ["드라마 OST Official MV"],
          weight: 1,
        },
      ],
    },
    rock: {
      label: "록",
      emoji: "🎸",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXbsaEIiliwyO",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX3oM43CtKnRV",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX6ntWKaOqGAp",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXcF6B6QPhFDv",
          weight: 1,
        },
        {
          type: "lastfm",
          tags: ["rock"],
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["밴드 Official MV", "J-ROCK MV 公式", "rock official music video"],
          weight: 2,
        },
      ],
    },
    edm: {
      label: "EDM",
      emoji: "🎛️",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
          weight: 3,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/7uMtlAoZ82WCBNlHtNH35l",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWZQaaqNMbbXa",
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["EDM official music video"],
          weight: 1,
        },
      ],
    },
    "city-pop": {
      label: "시티팝",
      emoji: "🌆",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX9AUX5YVf3hc",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWW28hvtiO3j9",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXdY5tVYFPWb2",
          weight: 1,
        },
        {
          type: "keyword",
          keywords: ["シティポップ 公式"],
          weight: 1,
        },
      ],
    },
    random: {
      label: "랜덤",
      emoji: "🎲",
      sources: [
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DWT9uTRZAYj0c",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DXafb0IuPwJyF",
          weight: 2,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX7iB3RCnBnN4",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX14fiWYoe7Oh",
          weight: 1,
        },
        {
          type: "spotify",
          url: "https://open.spotify.com/playlist/37i9dQZF1DX0hAXqBDwvwI",
          weight: 1,
        },
        {
          type: "youtube",
          url: "https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m",
          weight: 1,
        },
      ],
    },
  },
};

export default genresDefault;
