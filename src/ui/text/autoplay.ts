// 자동재생 장르 고르기 화면의 글자

/** 켤 때의 장르 메뉴 */
const pickGenre = () => ({ title: "🎲 음악 장르 선택", description: "어떤 장르를 재생할까요?", placeholder: "음악 장르를 선택하세요..." });
/** 끈 뒤 30초 동안 다른 장르로 다시 켤 수 있는 메뉴 */
const turnedOff = () => ({ title: "🎲 자동 재생이 비활성화되었습니다", description: "다른 장르로 다시 켜려면 아래에서 고르세요. 그냥 두면 꺼진 채로 둡니다.", placeholder: "장르를 바꿔 다시 켜기..." });
/** 장르를 골라 켰다 */
const turnedOn = (genre: string) => ({ title: "🎲 자동 재생이 활성화되었습니다", description: `**${genre}** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.`, by: "👤 변경한 사람" });

export { pickGenre, turnedOff, turnedOn };
