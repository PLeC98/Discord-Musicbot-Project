// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 재생 기록(이전 곡)은 몇 곡까지 남기나. 메모리의 기록과 세션 표가 같은 수를 본다
const HISTORY_MAX = 50;

const exported = { HISTORY_MAX };
export default exported;
export { exported as "module.exports" };
