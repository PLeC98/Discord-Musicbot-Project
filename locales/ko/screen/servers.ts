// 서버 목록, 서버 아이콘

import { formatNumber } from "../../../dashboard/src/utils/locale.ts";

/** 서버 아이콘의 상태 표 */
const playing = "재생 중";
const paused = "일시정지";
const waitingInVoice = "음성 채널에서 대기 중";

// 모든 서버 화면
const title = "모든 서버";
const count = (n: number) => `${n}곳`;
const empty = { title: "함께 있는 서버가 없어요", body: "봇을 서버에 초대하거나, 봇이 있는 서버에 참여하세요." };
const members = (n: number) => `멤버 ${formatNumber(n)}명`;
const listening = "듣는 중";
/** 디스코드에서 서버 목록을 받지 못해 이미 확인한 서버만 보일 때 */
const relogin = { body: "디스코드에서 서버 목록을 받지 못해 일부 서버가 안 보일 수 있어요. 다시 로그인하면 모두 보여요.", action: "다시 로그인" };
/** 봇의 Server Members Intent가 꺼져 서버 화면을 쓸 수 없을 때. body는 사용자에게, owner는 운영자에게 body 대신 보이는 고칠 방법 */
const membersOff = {
  title: "서버 화면을 쓸 수 없어요",
  body: "봇 설정상 서버 화면이 비활성화돼 있어요. 재생이나 서버 설정은 디스코드 명령어로 할 수 있어요. 서버 화면이 필요하면 봇 운영자에게 요청해 주세요.",
  owner: "개발자 포털의 Bot → Privileged Gateway Intents에서 Server Members Intent를 켜고 봇을 다시 시작하면 서버 화면을 쓸 수 있어요.",
  action: "운영자 패널",
};
const waitingInVoiceLong = "음성 채널에서 대기 중이에요";
const resting = "봇이 쉬고 있어요";
/** 인사(시각에 따라) */
const greeting = (hour: number, name: string) => `${hour < 6 ? "늦은 밤이에요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요"}, ${name}님`;

export { playing, paused, waitingInVoice, title, count, empty, members, listening, relogin, membersOff, waitingInVoiceLong, resting, greeting };
