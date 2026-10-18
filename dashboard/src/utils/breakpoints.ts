// 화면 크기 구분(JS 쪽). style.css 의 md · max-md 와 같은 기준이다: 휴대폰 = 폭 720 미만이거나 높이 512 이하(휴대폰 가로)

/** 휴대폰(틀은 위 막대 + 서랍, 배치는 휴대폰 것) */
export const PHONE_QUERY = "(max-width: 44.98rem), (max-height: 32rem)";
/** 낮은 화면(휴대폰 가로 등). 세로로 쌓으면 넘치는 화면은 가로로 나눈다 */
export const SHORT_QUERY = "(max-height: 32rem)";
