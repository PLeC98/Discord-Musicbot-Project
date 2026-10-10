// 재생목록 더 넣기(곡 넣기 칸 아래). 남은 자리 · 이름표는 봇 문장표(src/ui/text/ko/more)와 같은 것을 부른다

import { formatNumber } from "../../utils/locale.ts";

/** label 은 출처 이름(재생목록 · 앨범 등) */
const moreLeft = (label: string) => `${label}에 곡이 더 남아 있어요`;
const progress = (offset: number, total: number) => `${formatNumber(offset)} / ${formatNumber(total)}곡`;
const adding = "넣는 중";
const addingLong = "넣는 중...";
const add = "추가";
const closeIn = (seconds: number) => `닫기 · ${seconds}초 뒤 사라져요`;
/** 대기열이 가득 찼을 때(봇 문장 roomFull 뒤에 붙는다) */
const roomFullHint = "곡이 빠지면 바로 이어서 넣을 수 있어요.";
const amount = "넣을 곡 수";
const amountInput = "넣을 곡 수 직접 입력";
const remaining = (count: number) => `남은 ${formatNumber(count)}곡`;
const room = (count: number) => `대기열에 넣을 수 있는 자리 ${formatNumber(count)}곡`;

export { moreLeft, progress, adding, addingLong, add, closeIn, roomFullHint, amount, amountInput, remaining, room };
