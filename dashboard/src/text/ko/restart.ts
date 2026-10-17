// 봇 다시 시작(봇 상태 탭 · 운영 조절값의 다시 시작해야 적용되는 값)

const button = "다시 시작";
const unavailable = "실행기 없이 켠 봇이라 여기서 다시 시작할 수 없어요. 봇 폴더에서 pnpm start 로 켜면 쓸 수 있어요.";
const confirmTitle = "봇을 다시 시작할까요?";
const confirmBody = "재생이 잠깐 끊겼다가 이어져요. 대기열은 저장했다가 복원해요.";
const confirm = "다시 시작";
const waitingTitle = "봇을 다시 시작하는 중이에요";
const waiting = "봇이 다시 뜨면 이 화면을 새로 고쳐요. 보통 몇 초, 길면 30초쯤 걸려요.";
const timeoutTitle = "봇이 다시 뜨지 않았어요";
const timeoutBody = "봇을 띄운 터미널이나 로그를 확인해 주세요.";
const failed = "봇을 다시 시작하지 못했어요.";
/** 운영 조절값: 저장했지만 다시 시작해야 적용되는 값이 있다. names: 칸 이름(· 로 이음) */
const pending = (names: string) => `저장했지만 봇을 다시 시작해야 적용돼요: ${names}`;

export { button, unavailable, confirmTitle, confirmBody, confirm, waitingTitle, waiting, timeoutTitle, timeoutBody, failed, pending };
