// 봇 다시 시작(봇 상태 탭, 운영 설정값의 다시 시작해야 적용되는 값)

import { formatNumber } from "../../utils/locale.ts";

const button = "다시 시작";
const unavailable = "실행기 없이 켠 봇이라 여기서 다시 시작할 수 없어요. 봇 폴더에서 pnpm start로 실행하면 쓸 수 있어요.";
const confirmTitle = "봇을 다시 시작할까요?";
const confirm = "다시 시작";
const later = "나중에";
/** 창 맨 위에 보일 까닭(composables/bot-restart의 RestartReason) */
const reasons = { save: "저장한 값 중에 봇을 다시 시작해야 적용되는 것이 있어요.", snapshot: "복원한 설정은 봇을 다시 시작할 때 적용돼요." };
/**
 * 창의 안내. counts: 재생 중, 일시정지한 서버 수(읽는 중이거나 읽지 못했으면 null).
 * 재생 중인 서버가 없으면 끊기는 재생이 없다: 일시정지한 서버가 있으면 그 대기열을, 없으면 다시 켜지기까지의 시간을 알린다
 */
const confirmBody = (counts: { playing: number; paused: number } | null) => {
  if (counts?.playing === 0) return `지금 재생 중인 서버는 없어요.\n${counts.paused ? `일시정지한 ${formatNumber(counts.paused)}개 서버의 대기열은 저장했다가 복원해요.` : "봇이 다시 켜지기까지 보통 몇 초, 길면 30초쯤 걸려요."}`;
  return `${counts ? `현재 재생 중인 ${formatNumber(counts.playing)}개 서버의` : "재생 중인 서버의"} 재생이 잠시 끊어져요.\n대기열은 저장했다가 복원해요.`;
};
const announce = "재생 중인 서버에 다시 시작 공지 전송";
const waitingTitle = "봇을 다시 시작하는 중이에요";
const waiting = "봇이 다시 시작되면 이 화면을 새로고침해요. 보통 몇 초, 길면 30초쯤 걸려요.";
const timeoutTitle = "봇이 다시 시작되지 않았어요";
const timeoutBody = "봇을 실행한 터미널이나 로그를 확인해 주세요.";
const failed = "봇을 다시 시작하지 못했어요.";
/** 운영 설정값: 저장했지만 다시 시작해야 적용되는 값이 있다. names: 필드 이름(쉼표로 이음) */
const pending = (names: string) => `저장했지만 봇을 다시 시작해야 적용돼요: ${names}`;

export { button, unavailable, confirmTitle, confirmBody, confirm, later, reasons, announce, waitingTitle, waiting, timeoutTitle, timeoutBody, failed, pending };
