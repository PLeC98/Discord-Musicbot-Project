// 디스코드 ID(스노플레이크)의 형식. 앱, 서버, 사용자 ID 모두 17 ~ 20자리 숫자다

const SNOWFLAKE = /^\d{17,20}$/;

/** 디스코드 ID 형식의 문자열인가 */
const isSnowflake = (value: unknown): boolean => typeof value === "string" && SNOWFLAKE.test(value);

export { isSnowflake };
