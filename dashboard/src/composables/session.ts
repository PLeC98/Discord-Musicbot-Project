// 로그인 세션과 서버 연결의 상태. 요청 한 곳(utils/request)이 적고, 화면은 대화상자 · 띠를 띄우며 실시간 연결 · 주기 읽기를 멈춘다
// ended: 401 을 받았다(세션이 끝났다). 다시 로그인할 때까지 실시간 연결을 닫는다. 편집 중인 화면은 그대로 둔다
// offline: 마지막 요청이 서버에 닿지 못했다(봇이 꺼졌거나 네트워크). 로그아웃이 아니다
// streamDown: 탭의 실시간 연결(stores/guilds)이 열려 있지 않다. 다시 잇는 동안은 30초마다 전부 다시 읽는다

import { reactive } from "vue";

export const session = reactive({ ended: false, offline: false, streamDown: false });

/** 실시간 연결 · 주기 읽기를 해도 되는지. 탭이 보이고 세션이 살아 있을 때만 */
export const live = (): boolean => !document.hidden && !session.ended;
