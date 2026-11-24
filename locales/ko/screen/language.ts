// 화면 언어 고르기: 설정 창의 언어 줄, 로그인 화면의 지구본 버튼, 로그인 화면에서 고른 언어를 로그인한 뒤 계정에 옮겼을 때의 알림

/** 설정 창의 묶음 이름 */
const title = "언어";
/** 설정 창의 줄(디스코드 /language의 "내 언어"와 같은 값) */
const mine = "내 언어";
/** 자동이 지금 쓰는 언어를 같이 보여 준다(디스코드 /language와 같은 모양) */
const autoWith = (name: string) => `자동 (${name})`;
const appliesToDiscord = "디스코드의 본인 응답에도 적용돼요";
const savedToAccount = "고른 언어를 계정 언어로 저장했어요";
const saveFailed = "언어를 저장하지 못했어요";
/** 로그인 화면의 지구본 버튼(화면 읽기 이름, 툴팁) */
const pick = "언어 선택";

export { title, mine, autoWith, appliesToDiscord, savedToAccount, saveFailed, pick };
