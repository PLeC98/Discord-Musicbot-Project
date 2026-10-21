// 운영자 패널: 실시간 로그 탭

import { formatNumber } from "../../utils/locale.ts";

const title = "실시간 로그";
const connected = "연결됨";
const disconnected = "끊김";
const lines = (count: number) => `${formatNumber(count)}줄`;
const allCategories = "모든 카테고리";
const allTags = "모든 태그";
const autoScroll = "자동 스크롤";
const clear = "지우기";
const empty = "표시할 로그가 아직 없어요";
const search = "로그에서 찾기";
/** 표시 줄: 다시 붙었을 때 서버가 쌓아 둔 줄 밖으로 밀려나 받지 못한 줄 · 봇 재시작 */
const missed = (count: number, kept: number) => `보관 한도 ${formatNumber(kept)}줄을 넘어 ${formatNumber(count)}줄을 받지 못했어요`;
const restarted = "봇이 다시 시작했어요";

export { title, connected, disconnected, lines, allCategories, allTags, autoScroll, clear, empty, search, missed, restarted };
