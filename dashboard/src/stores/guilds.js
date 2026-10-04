import { defineStore } from "pinia";
import axios from "axios";
import { watch } from "vue";
import { session, live } from "../composables/session.js";
import { eventLink } from "../utils/event-link.js";

// 탭 하나에 실시간 연결 하나. 이 연결이 사용자가 볼 수 있는 모든 서버의 "바뀜" 신호를 싣고,
// 서버 목록 · 사이드바 · 재생 바 · 서버 화면이 같이 쓴다(연결 상한이 사용자당이라 화면마다 열면 넘친다).
// 받는 쪽은 바뀐 서버 ID 를 받는다. null 이면 어느 서버인지 모른다(끊긴 동안 놓쳤을 수 있다): 전부 다시 읽는다
const nudgeHandlers = new Set();

export function onGuildNudge(fn) {
  nudgeHandlers.add(fn);
  return () => nudgeHandlers.delete(fn);
}
const nudgeAll = (guildId) => nudgeHandlers.forEach((fn) => fn(guildId));

// 연결 · 타이머 핸들은 반응성이 필요 없으므로 모듈 스코프에 둔다
let subscribers = 0;
let link = null;
let fallbackTimer = null;
let nudgeTimer = null;
let visHandler = null;
let stopSessionWatch = null;
let missed = false; // 열리지 않은 동안이 있었다. 다시 열리면 놓친 변화를 따라잡는다

const FALLBACK_MS = 30_000;

// 상호(유저∩봇) 서버 목록. 구독 카운팅으로 연결을 하나로: 첫 구독자가 열고, 마지막 구독자가 닫는다.
export const useGuildsStore = defineStore("guilds", {
  state: () => ({
    guilds: [],
    loading: true,
  }),
  actions: {
    async refresh() {
      try {
        const res = await axios.get("/api/guilds");
        this.guilds = res.data.guilds;
      } catch {
        // 지금 목록을 둔다. 까닭은 띠(연결 안 됨 · 세션 끝)가 알리고, 다음 신호 · 주기 읽기에서 회복
      } finally {
        this.loading = false;
      }
    },

    subscribe() {
      if (++subscribers > 1) return;
      this.refresh();

      // 열리지 않은 동안만 30초마다 전부 다시 읽는다
      const startFallback = () => {
        fallbackTimer ??= setInterval(() => {
          this.refresh();
          nudgeAll(null);
        }, FALLBACK_MS);
      };
      const stopFallback = () => {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      };

      link = eventLink({
        url: "/api/guilds/events",
        open: (url) => new EventSource(url, { withCredentials: true }),
        check: async () => (await axios.get("/api/me")).status === 200,
        events: {
          message: (e) => {
            // 페이로드: {"t":"changed","g":"<guildId>"}
            let guildId = null;
            try {
              guildId = JSON.parse(e.data)?.g ?? null;
            } catch {
              // 형식이 바뀌었더라도 "뭔가 바뀜"이라는 신호는 살린다
            }
            nudgeAll(guildId);
            clearTimeout(nudgeTimer);
            nudgeTimer = setTimeout(() => this.refresh(), 150);
          },
        },
        onState: (state) => {
          session.streamDown = state !== "open";
          if (state !== "open") {
            missed = true;
            startFallback();
            return;
          }
          stopFallback();
          if (missed) {
            missed = false;
            this.refresh();
            nudgeAll(null);
          }
        },
      });

      // 탭이 숨거나 세션이 끝나면 접는다(끝난 세션으로 401 을 거듭 받지 않게). 다시 보이거나 다시 로그인하면 열고 따라잡는다
      visHandler = () => {
        if (live()) {
          link.start();
          return;
        }
        link.stop();
        stopFallback();
        clearTimeout(nudgeTimer);
        session.streamDown = false;
        missed = true;
      };
      document.addEventListener("visibilitychange", visHandler);
      stopSessionWatch = watch(() => session.ended, visHandler);
      missed = false;
      if (live()) link.start();
    },

    unsubscribe() {
      if (--subscribers > 0) return;
      document.removeEventListener("visibilitychange", visHandler);
      visHandler = null;
      stopSessionWatch?.();
      stopSessionWatch = null;
      link?.stop();
      link = null;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
      clearTimeout(nudgeTimer);
      session.streamDown = false;
      this.loading = true; // 다음 첫 구독 때 로딩 표시부터 시작
    },
  },
});
