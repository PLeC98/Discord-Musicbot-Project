module.exports = {
  rotationInterval: 60,
  rotation: [{ text: "🎵 /play" }, { text: "🎶 음악으로 하루를 채워봐요" }],
  scheduled: [
    // 크리스마스 (12/24~26)
    {
      dateRange: { start: "12-24", end: "12-26" },
      text: "🎄 메리 크리스마스!",
    },
    // 야간 (22:00~06:00)
    {
      timeRange: { start: "22:00", end: "06:00" },
      rotation: [{ text: "🌌 별빛 아래 음악" }, { text: "🛌 잠들기 전 노래 한곡" }, { text: "🌑 달빛 아래 음악" }, { text: "💤 졸려..." }, { text: "🌃 밤새 함께해요" }],
    },
    // 새해 (1/1~2)
    {
      dateRange: { start: "01-01", end: "01-02" },
      rotation: [{ text: "🎉 새해 복 많이 받으세요!" }, { text: "🥳 올해에도 좋은 음악과 함께!" }],
    },
    // 설날 (음력 1/1~15)
    {
      lunarDateRange: { start: "01-01", end: "01-15" },
      rotation: [{ text: "🌕 설날 맞이 음악" }, { text: "🐉 새해 복 많이 받으세요!" }],
    },
    // 할로윈 (10/31~11/2)
    {
      dateRange: { start: "10-31", end: "11-02" },
      rotation: [{ text: "🎃 할로윈 분위기" }, { text: "👻 무서운 음악 모드" }],
    },
    // 발렌타인 (2/14~15)
    {
      dateRange: { start: "02-14", end: "02-15" },
      rotation: [{ text: "💖 발렌타인 데이 스페셜" }, { text: "🌹 사랑이 가득한 음악" }],
    },
    // 봄 (3월)
    {
      dateRange: { start: "03-01", end: "03-31" },
      rotation: [{ text: "🌸 흩날리는 벚꽃 잎이♪" }, { text: "🌼 봄바람 휘날리며♪" }],
    },
    // 여름 (7/20~8/10)
    {
      dateRange: { start: "07-20", end: "08-10" },
      text: "🏖️ 어디로 떠날까요?",
    },
    // 가을 (9월)
    {
      dateRange: { start: "09-01", end: "09-30" },
      rotation: [{ text: "🍂 너를 닮은 이 시린 가을이 오면♪" }, { text: "🍁 낙엽과 함께하는 음악" }],
    },
    // 겨울 (12월)
    {
      dateRange: { start: "12-01", end: "12-31" },
      rotation: [{ text: "❄️ 눈꽃이 피어나 또 빛이 나♪" }, { text: "⛄ 내 맘을 다 아나봐 하늘에서도♪" }],
    },
  ],
};
