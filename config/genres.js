// 자동재생 장르 정의 — 장르 추가/제거/키워드 수정은 이 파일 한 곳만 수정하면 버튼 셀렉트 메뉴 / 슬래시 커맨드 choices / 확인 메시지 / YouTube 검색에 모두 반영
//
//  - 키(id): 영문 소문자. 슬래시 커맨드 choices에는 첫 글자만 대문자로 노출
//  - label: 버튼 메뉴와 확인 메시지에 쓰이는 한국어 표기
//  - emoji: 버튼 메뉴 아이콘
//  - keywords: YouTube 검색어 후보 — 자동재생 시 매번 무작위로 1개 선택
//
//  주의:
//  - Discord 한도로 UI(셀렉트 메뉴/choices) 노출은 최대 25개까지만 가능
//  - 슬래시 커맨드 choices는 기동 시 등록되므로 변경 후 봇 재시작 필요
module.exports = {
  pop: {
    label: "팝",
    emoji: "🎤",
    keywords: ["pop music 2024", "top pop songs", "pop hits official", "best pop music"],
  },
  rock: {
    label: "록",
    emoji: "🎸",
    keywords: ["rock music official", "rock songs 2025", "classic rock hits", "best rock music"],
  },
  hiphop: {
    label: "힙합",
    emoji: "🎧",
    keywords: ["hip hop music", "rap songs official", "hip hop 2025", "best rap music"],
  },
  electronic: {
    label: "일렉트로닉",
    emoji: "🎛️",
    keywords: ["edm music", "electronic dance music", "house music official", "best edm"],
  },
  jazz: {
    label: "재즈",
    emoji: "🎷",
    keywords: ["jazz music", "jazz standards", "smooth jazz official", "best jazz"],
  },
  classical: {
    label: "클래식",
    emoji: "🎻",
    keywords: ["classical music", "classical piano", "orchestra music", "best classical"],
  },
  metal: {
    label: "메탈",
    emoji: "🤘",
    keywords: ["metal music official", "heavy metal songs", "metal 2025", "best metal"],
  },
  country: {
    label: "컨트리",
    emoji: "🤠",
    keywords: ["country music official", "country songs 2025", "best country music"],
  },
  rnb: {
    label: "R&B",
    emoji: "💃",
    keywords: ["r&b music official", "rnb songs 2025", "soul music", "best rnb"],
  },
  indie: {
    label: "인디",
    emoji: "🌿",
    keywords: ["indie music official", "indie songs 2025", "alternative music", "best indie"],
  },
  kpop: {
    label: "K-POP",
    emoji: "🇰🇷",
    keywords: ["kpop official mv", "kpop songs 2025", "korean music official", "best kpop"],
  },
  anime: {
    label: "애니메",
    emoji: "🎌",
    keywords: ["アニメ オープニング 公式", "アニソン 公式", "2026 アニソン", "アニメ神曲"],
  },
  lofi: {
    label: "로파이",
    emoji: "🌙",
    keywords: ["lofi hip hop music", "lofi beats official", "chill lofi music", "best lofi"],
  },
  random: {
    label: "랜덤",
    emoji: "🎲",
    keywords: ["music official video", "top songs 2025", "music video official", "best music"],
  },
};
