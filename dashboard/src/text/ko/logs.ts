// 운영자 패널: 실시간 로그 탭 · 로그 파일 보기

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
const missed = (count: number) => `연결이 끊긴 사이 ${formatNumber(count)}줄이 실시간 버퍼에서 밀려났어요`;
const restarted = "봇이 다시 시작했어요";

/** 머리의 "파일 보기 ›"(로그 파일 보기 페이지로) · 밀려난 줄 표시 끝의 "파일에서 보기 ›"(그 시각으로) */
const openFiles = "파일 보기";
const gapToFile = "파일에서 보기";
/** 거르기 창의 묶음 */
const filterLevels = "레벨";
const filterCategories = "카테고리 · 태그";
const filterView = "보기";

const two = (n: number) => String(n).padStart(2, "0");
// 로그 파일 보기
const files = {
  title: "로그 파일",
  /** 위 막대의 돌아가기(실시간 로그로) */
  back: title,
  download: "내려받기",
  downloadTip: "지금 건 거르기 그대로, 화면과 같은 칸을 글로 받아요.",
  search: "파일에서 찾기",
  latest: "최신 파일",
  /** 떼어 낸 파일: 날짜가 아니라 크기로 떼어 내므로 마지막 줄의 시각까지 적는다("언제부터"는 바로 앞 파일이 말해 준다) */
  until: (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${d.getHours() < 12 ? "AM" : "PM"} ${two(d.getHours() % 12 || 12)}:${two(d.getMinutes())}:${two(d.getSeconds())} 까지`;
  },
  whenFile: "파일 · 날짜 · 시간",
  when: "날짜 · 시간",
  loading: "불러오는 중",
  empty: "줄이 없어요",
  loadFailed: "로그 파일을 읽지 못했어요",
  off: "파일 로그가 꺼져 있어 지난 기록이 없어요",
};

export { title, connected, disconnected, lines, allCategories, allTags, autoScroll, clear, empty, search, missed, restarted, openFiles, gapToFile, filterLevels, filterCategories, filterView, files };
