// 디스코드 명령 · 버튼과 대시보드가 같이 지키는 상한

/** 음량은 0 ~ VOLUME_MAX 의 정수 */
const VOLUME_MAX = 100;

/** 디스코드 선택 메뉴 하나에 들어가는 선택지 수(한 번에 고르는 수도 같다). 넘기면 디스코드가 메뉴를 거부한다 */
const SELECT_MAX = 25;

/** DJ 역할은 역할 선택 메뉴가 한 번에 고르는 만큼까지 */
const DJ_ROLE_MAX = SELECT_MAX;

export { VOLUME_MAX, SELECT_MAX, DJ_ROLE_MAX };
