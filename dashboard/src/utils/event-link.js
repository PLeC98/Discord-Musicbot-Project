// 실시간 연결(EventSource) 하나를 들고 있다.
// 200 으로 연 뒤 끊기면 브라우저가 스스로 다시 붙는다(마지막 id 를 싣는다). 200 이 아닌 답(상한 · 준비 전 · 세션 끝)이면 닫히고 다시 붙지 않아,
// 늘려 가는 간격(utils/reconnect)으로 화면이 다시 연다. 다시 열기 전에 check 로 로그인이 살아 있는지 본다(401 이면 요청 한 곳이 세션 끝으로 돌린다)

import { reopenDelay } from "./reconnect.js";

const CLOSED = 2; // EventSource.CLOSED

/**
 * url: 열 주소(함수면 열 때마다 부른다). open(url): EventSource 를 만든다. events: 이벤트 이름 → 받는 함수.
 * onState("open" | "retrying" | "down"): 열림 · 브라우저가 다시 붙는 중 · 닫혀 화면이 다시 열 차례를 기다림.
 * check(): 다시 열어도 되는지(로그인이 살아 있는지). schedule · cancel · delay 는 시험이 바꾼다
 */
export function eventLink({ url, open, events, onState = () => {}, check = async () => true, delay = reopenDelay, schedule = setTimeout, cancel = clearTimeout }) {
  let source = null;
  let timer = null;
  let attempt = 0;
  let wanted = false;

  function connect() {
    const one = open(typeof url === "function" ? url() : url);
    source = one;
    one.onopen = () => {
      attempt = 0;
      onState("open");
    };
    for (const [name, fn] of Object.entries(events)) one.addEventListener(name, fn);
    one.onerror = () => {
      if (source !== one) return;
      if (one.readyState !== CLOSED) return onState("retrying");
      source = null;
      onState("down");
      reopenLater();
    };
  }

  function reopenLater() {
    timer = schedule(async () => {
      timer = null;
      let ok;
      try {
        ok = await check();
      } catch {
        ok = false;
      }
      if (!wanted || source || timer) return;
      if (ok) connect();
      else reopenLater();
    }, delay(attempt++));
  }

  return {
    /** 열어 둔다. 이미 열렸거나 다시 열 차례를 기다리면 그대로 */
    start() {
      wanted = true;
      if (!source && !timer) connect();
    },
    /** 닫고 다시 열지 않는다(탭이 숨음 · 세션 끝 · 화면을 떠남) */
    stop() {
      wanted = false;
      cancel(timer);
      timer = null;
      source?.close();
      source = null;
      attempt = 0;
    },
  };
}
