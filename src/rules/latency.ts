// 응답 시간의 등급. /ping 과 대시보드 운영자 패널이 같은 기준으로 색을 정한다

type LatencyGrade = "good" | "fair" | "poor";

/** 100ms 아래는 좋음, 300ms 아래는 보통, 그 위는 나쁨 */
const latencyGrade = (ms: number): LatencyGrade => (ms < 100 ? "good" : ms < 300 ? "fair" : "poor");

export { latencyGrade };
export type { LatencyGrade };
