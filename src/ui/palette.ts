// 경고 수준마다의 고정 색(디스코드 기본 팔레트). 설정을 읽지 않아 화면(대시보드 계약)도 부른다.
// 완료(초록)는 서버 설정을 바꿔 저장한 결과와 봇 업데이트 공지에 쓴다. 오래 남는 변경이라 눈에 띄게.

const FIXED_COLORS = {
  error: "#ED4245", // 봇 쪽 문제 · 외부 실패로 못 했다
  warning: "#FEE75C", // 사용자가 고칠 수 있거나 지금 상태라 못 했다 · 일부만 됐다
  done: "#57F287", // 서버 설정을 저장했다 · 봇을 업데이트했다
  notice: "#3498DB", // 운영자가 모든 서버에 알리는 공지사항
} as const satisfies Record<string, `#${string}`>;

export { FIXED_COLORS };
