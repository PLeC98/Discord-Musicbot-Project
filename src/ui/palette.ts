// 경고 수준마다의 고정 색(디스코드 기본 팔레트). 설정을 읽지 않아 화면(대시보드 공유 타입)도 부른다.
// 완료(초록)는 서버 설정을 바꿔 저장한 결과와 봇 업데이트 공지에 쓴다. 오래 남는 변경이라 눈에 띄게.

const FIXED_COLORS = {
  error: "#ED4245", // 봇 쪽 문제, 외부 실패로 못 했다
  warning: "#FEE75C", // 사용자가 고칠 수 있거나 지금 상태라 못 했다, 일부만 됐다
  done: "#57F287", // 서버 설정을 저장했다, 봇을 업데이트했다
  notice: "#3498DB", // 운영자가 모든 서버에 알리는 공지사항
} as const satisfies Record<string, `#${string}`>;

/** 곡 출처 로고의 타일 색(각 회사의 브랜드 색. 유튜브는 브랜드 페이지의 새 값, 스포티파이는 공식 아이콘 파일의 값) */
const BRAND_COLORS = {
  youtube: "#FF0033",
  spotify: "#1ED760",
} as const satisfies Record<string, `#${string}`>;

/** 디스코드 색 버튼(블러플, 초록, 빨강) 위의 글자 색. 그 위에 올리는 앱 이모지의 흰 기호(ui/icon-images)도 같다 */
const ON_COLOR_BUTTON = "#FFFFFF";

export { FIXED_COLORS, BRAND_COLORS, ON_COLOR_BUTTON };
