// 디스코드 명령, 버튼과 대시보드가 같이 지키는 상한

/** 볼륨은 0 ~ VOLUME_MAX 의 정수. VOLUME_BASE 가 원래 크기(0 dB)이고 그 위는 증폭이다 */
const VOLUME_BASE = 100;
const VOLUME_MAX = 125;

/** 디스코드 선택 메뉴 하나에 들어가는 선택지 수(한 번에 선택하는 수도 같다). 넘기면 디스코드가 메뉴를 거부한다 */
const SELECT_MAX = 25;

/** DJ 역할은 역할 선택 메뉴가 한 번에 선택하는 만큼까지 */
const DJ_ROLE_MAX = SELECT_MAX;

/** 곡 글자 검색(/search, 대시보드 곡 추가 칸)의 검색어 글자 수. 하한보다 짧으면 찾지 않는다. 상한은 /search 옵션의 최대 길이(디스코드 자동완성 선택지 값이 100자까지다) */
const SEARCH_MIN_LEN = 2;
const SEARCH_MAX_LEN = 100;

export { VOLUME_BASE, VOLUME_MAX, SELECT_MAX, DJ_ROLE_MAX, SEARCH_MIN_LEN, SEARCH_MAX_LEN };
