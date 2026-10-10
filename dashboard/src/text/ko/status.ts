// 운영자 패널: 봇 상태 탭과 그 그래프

/** 그래프 가로축의 왼쪽 끝 · 오른쪽 끝 */
const minutesAgo = (minutes: number) => `${minutes}분 전`;
const now = "지금";
/** 그래프의 화면 읽기 요약. 값은 단위를 붙여 적은 글 */
const chartSummary = ({ minutes, min, max, axisMax }: { minutes: number; min: string; max: string; axisMax: string }) => `최근 ${minutes}분, 최저 ${min}, 최고 ${max}, 세로축 최대 ${axisMax}`;

export { minutesAgo, now, chartSummary };
