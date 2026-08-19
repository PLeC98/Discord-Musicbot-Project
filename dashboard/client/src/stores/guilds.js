import { defineStore } from "pinia";
import axios from "axios";

// SSE/타이머 핸들은 반응성이 필요 없으므로 모듈 스코프에 둔다
let subscribers = 0;
let timer = null;
let eventSource = null;
let nudgeTimer = null;
let visHandler = null;

// 상호(유저∩봇) 서버 목록 — 사이드바와 서버 목록 화면(ServersView)이 공유.
// 구독 카운팅으로 SSE·폴링을 단일화: 첫 구독자가 연결을 열고, 마지막 구독자가 닫는다.
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
        // 일시적 오류는 무시 — 다음 폴링/넛지에서 회복
      } finally {
        this.loading = false;
      }
    },

    // 재생 상태는 이벤트성 → SSE 넛지로 즉시 갱신(사용자 단위 멀티플렉스).
    // 목록 구성(어느 서버냐)은 드무니 느린 폴백 폴링으로.
    subscribe() {
      if (++subscribers > 1) return;
      this.refresh();

      // 폴링은 SSE가 끊겼을 때만 도는 진짜 폴백. (기존엔 SSE 정상 여부와 무관하게
      // 30초마다 /api/guilds를 무조건 호출해 요청이 쌓였음)
      const startFallback = () => {
        if (!timer) timer = setInterval(() => this.refresh(), 30000);
      };
      const stopFallback = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const openStream = () => {
        if (eventSource) return;
        eventSource = new EventSource("/api/guilds/events", { withCredentials: true });
        eventSource.onopen = () => {
          if (timer) this.refresh(); // 끊긴 동안 놓친 변화 재동기화 후 폴백 중지
          stopFallback();
        };
        eventSource.onmessage = () => {
          clearTimeout(nudgeTimer);
          nudgeTimer = setTimeout(() => this.refresh(), 150);
        };
        eventSource.onerror = () => startFallback(); // SSE 끊김 → 폴백 폴링 시작 (재연결 시 onopen에서 중지)
      };
      const closeStream = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        stopFallback();
        clearTimeout(nudgeTimer);
      };

      // 탭이 숨으면 SSE·폴링을 모두 접어 백그라운드에서 완전 무음, 다시 보이면 재개 + 즉시 동기화
      visHandler = () => {
        if (document.hidden) closeStream();
        else {
          this.refresh();
          openStream();
        }
      };
      document.addEventListener("visibilitychange", visHandler);
      if (!document.hidden) openStream(); // 숨겨진 채 마운트되면 visibilitychange가 이후 처리
    },

    unsubscribe() {
      if (--subscribers > 0) return;
      if (visHandler) {
        document.removeEventListener("visibilitychange", visHandler);
        visHandler = null;
      }
      clearInterval(timer);
      timer = null; // startFallback의 !timer 가드가 다음 구독에서 정상 동작하도록 초기화
      clearTimeout(nudgeTimer);
      if (eventSource) eventSource.close();
      eventSource = null;
      this.loading = true; // 다음 첫 구독 때 로딩 표시부터 시작
    },
  },
});
