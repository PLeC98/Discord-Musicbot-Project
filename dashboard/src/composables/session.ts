// 로그인 세션과 서버 연결의 상태. 요청 한 곳(utils/request)이 적고, 화면은 대화상자 · 띠를 띄우며 실시간 연결 · 주기 읽기를 멈춘다
// ended: 401 을 받았다(세션이 끝났다). 다시 로그인할 때까지 실시간 연결을 닫는다. 편집 중인 화면은 그대로 둔다
// reauth: 위험한 조작(비밀값 · 주소 바꾸기 · 다시 시작)을 로그인한 지 10분이 지나 거절당했다. 세션은 살아 있고 로그인 창에서 다시 로그인하면 거절된 요청을 다시 보낸다
// offline: 마지막 요청이 서버에 닿지 못했다(봇이 꺼졌거나 네트워크). 로그아웃이 아니다
// streamDown: 탭의 실시간 연결(stores/guilds)이 열려 있지 않다. 다시 잇는 동안은 30초마다 전부 다시 읽는다

import { reactive } from "vue";

export const session = reactive({ ended: false, reauth: false, offline: false, streamDown: false });

// ── 다시 로그인 ──
// 로그인은 작은 창(로그인 창)에서 한다. 끝나면 그 창(/login-done)이 같은 주소의 탭들에 알리고 스스로 닫는다.
// window.opener 는 쓰지 않는다. 디스코드를 거쳐 오면 끊길 수 있다(브라우저의 창 격리)

const CHANNEL = "musicbot-session";

/** 로그인 창을 연다. 사용자가 누른 때에만 부른다(아니면 브라우저가 막는다) */
export function openLoginWindow(): void {
  const width = 520;
  const height = 760;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  window.open("/auth/login?popup=1", "musicbot-login", `popup,width=${width},height=${height},left=${left},top=${top}`);
}

/** 로그인 창이 부른다: 로그인을 마쳤다 */
export function announceSignedIn(): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("signed-in");
  channel.close();
}

/** 다른 창에서 로그인을 마치면 부른다. 떼는 함수를 돌려준다 */
export function onSignedIn(listener: () => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === "signed-in") listener();
  };
  return () => channel.close();
}

// 다시 로그인을 기다리는 요청들. 마치면 다시 보내고(true), 그만두면 원래 거절대로 실패한다(false)
let reauthWaiters: Array<(signedIn: boolean) => void> = [];

/** 위험한 조작이 reauth-required 로 거절됐다. 대화상자를 띄우고 다시 로그인을 마칠 때까지 기다린다 */
export function waitForReauth(): Promise<boolean> {
  session.reauth = true;
  return new Promise((resolve) => reauthWaiters.push(resolve));
}

/** 다시 로그인을 마쳤거나(true) 그만뒀다(false) */
export function endReauth(signedIn: boolean): void {
  session.reauth = false;
  const waiters = reauthWaiters;
  reauthWaiters = [];
  for (const resolve of waiters) resolve(signedIn);
}

/** 실시간 연결 · 주기 읽기를 해도 되는지. 탭이 보이고 세션이 살아 있을 때만 */
export const live = (): boolean => !document.hidden && !session.ended;
