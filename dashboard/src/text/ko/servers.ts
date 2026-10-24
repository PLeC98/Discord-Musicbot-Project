// 서버 목록 · 서버 아이콘

import { formatNumber } from "../../utils/locale.ts";

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
const waitingInVoiceLong = "음성 채널에서 대기 중이에요";
const resting = "봇이 쉬고 있어요";
/** 인사(시각에 따라) */
const greeting = (hour: number, name: string) => `${hour < 6 ? "늦은 밤이에요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요"}, ${name}님`;

export { playing, paused, waitingInVoice, title, count, empty, members, listening, waitingInVoiceLong, resting, greeting };
