// 자동재생 장르 선택 화면의 문구

/** 켤 때의 장르 메뉴 */
const pickGenre = () => ({ title: "🎲 자동재생 장르 선택", description: "어떤 장르를 재생할까요?", placeholder: "장르를 선택해 주세요!" });
/** 끈 뒤 메뉴가 열려 있는 동안 다른 장르로 다시 켤 수 있는 메뉴 */
const turnedOff = () => ({
  title: "🎲 자동재생을 껐어요!",
  description: "장르를 바꾸려던 거라면 아래에서 선택해 주세요! 자동재생을 끄려던 거라면 선택하지 않고 두면 돼요.",
  placeholder: "바꿀 장르를 선택해 주세요!",
});
/** 장르를 선택해 켰다 */
const turnedOn = (genre: string) => ({ title: "🎲 자동재생을 시작할게요!", description: `**${genre}** 장르로 켰어요. 직접 넣어둔 대기열이 끝나면 자동재생 곡들이 나와요.`, by: "👤 요청한 사람" });

export { pickGenre, turnedOff, turnedOn };
