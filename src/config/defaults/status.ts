// 봇 활동 문구 기본값. settings.db 에 "status" 문서가 없을 때 이것으로 시작한다(config/documents). 검사는 config/schema/status

const statusDefault: Record<string, unknown> = {
  interval: 60,
  messages: ["🎵 /play", "🎶 음악으로 하루를 채워봐요"],
  special: {
    크리스마스: {
      date: "12-24 ~ 12-26",
      messages: ["🎄 메리 크리스마스!"],
    },
    심야: {
      time: "22:00 ~ 06:00",
      messages: ["🌌 별빛 아래 음악", "🛌 잠들기 전 노래 한곡", "🌑 달빛 아래 음악", "💤 졸려...", "🌃 밤새 함께해요"],
    },
    새해: {
      date: "01-01 ~ 01-02",
      messages: ["🎉 새해 복 많이 받으세요!", "🥳 올해에도 좋은 음악과 함께!"],
    },
    설날: {
      lunar: "01-01 ~ 01-15",
      messages: ["🌕 설날 맞이 음악", "🐉 새해 복 많이 받으세요!"],
    },
    할로윈: {
      date: "10-31 ~ 11-02",
      messages: ["🎃 할로윈 분위기", "👻 무서운 음악 모드"],
    },
    발렌타인: {
      date: "02-14 ~ 02-15",
      messages: ["💖 발렌타인 데이 스페셜", "🌹 사랑이 가득한 음악"],
    },
    봄: {
      date: "03-01 ~ 03-31",
      messages: ["🌸 흩날리는 벚꽃 잎이♪", "🌼 봄바람 휘날리며♪"],
    },
    여름휴가: {
      date: "07-20 ~ 08-10",
      messages: ["🏖️ 어디로 떠날까요?"],
    },
    가을: {
      date: "09-01 ~ 09-30",
      messages: ["🍂 너를 닮은 이 시린 가을이 오면♪", "🍁 낙엽과 함께하는 음악"],
    },
    겨울: {
      date: "12-01 ~ 12-31",
      messages: ["❄️ 눈꽃이 피어나 또 빛이 나♪", "⛄ 내 맘을 다 아나봐 하늘에서도♪"],
    },
  },
};

export default statusDefault;
