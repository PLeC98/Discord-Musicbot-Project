// /language 패널의 문구. 언어 이름은 그 언어로 쓴 이름(rules/languages)이라 여기 없다

/** 패널의 제목, 두 부분의 이름과 쓰이는 곳, 메뉴 자리표시 */
const panel = () => ({
  title: "언어",
  mine: "내 언어",
  mineAbout: "본인에게만 보이는 답과 대시보드에 써요.",
  server: "서버 언어",
  serverAbout: "이 서버의 공개 메시지(재생 패널, 알림)에 써요.",
  minePlaceholder: "내 언어를 골라 주세요",
  serverPlaceholder: "서버 언어를 골라 주세요",
});
/** 내 언어의 자동. name은 지금 풀린 언어의 이름 */
const auto = (name: string) => `자동 (${name})`;
/** 서버 언어의 봇 기본 언어를 따름. name은 지금 봇 기본 언어의 이름 */
const followBot = (name: string) => `봇 기본 언어를 따름 (${name})`;

export { panel, auto, followBot };
