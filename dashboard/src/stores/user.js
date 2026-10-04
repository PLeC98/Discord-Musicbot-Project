import { defineStore } from "pinia";
import axios from "axios";
import { session } from "../composables/session.js";

// 권한 수준 오버라이드 계층. 서버 src/dashboard/view-as.ts의 TIERS와 순서·키를 맞춘다.
// null(해제)은 목록에 넣지 않는다. 선택지가 아니라 "오버라이드 없음" 상태다.
export const VIEW_AS_TIERS = [
  { id: "owner", label: "봇 운영자", desc: "모든 서버·모든 조작. 오버라이드 없음과 같은 상태입니다." },
  { id: "moderator", label: "서버 관리자", desc: "서버 관리·차단·추방·타임아웃 중 하나를 가진 사람. 재적 규칙을 면제받습니다." },
  { id: "dj", label: "DJ", desc: "DJ 역할 보유자. 재생 조작은 되지만 봇과 같은 음성 채널에 있어야 합니다." },
  { id: "user", label: "일반 유저", desc: "DJ 역할이 지정된 서버에서는 조작이 막히고, 곡 추가만 됩니다." },
];

export const useUserStore = defineStore("user", {
  state: () => ({
    data: null,
    fetched: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.data,
    // 오버라이드가 반영된 값. UI가 그 계층으로 보이게 한다
    isOwner: (s) => s.data?.isOwner ?? false,
    // 오버라이드와 무관한 실제 값. 해제 수단을 계속 노출하기 위한 것
    isRealOwner: (s) => s.data?.isRealOwner ?? false,
    viewAs: (s) => s.data?.viewAs ?? null,
    viewAsLabel: (s) => VIEW_AS_TIERS.find((t) => t.id === s.data?.viewAs)?.label ?? null,
    displayName: (s) => s.data?.globalName || s.data?.username || "",
    avatarUrl: (s) => (s.data?.avatar ? `https://cdn.discordapp.com/avatars/${s.data.id}/${s.data.avatar}.webp?size=64` : null),
  },
  actions: {
    // 401 이면 로그인하지 않았다(처음 들어온 사람이라 세션 끝 대화상자는 띄우지 않는다).
    // 그 밖의 실패(응답 없음 · 서버 오류)는 모른다: fetched 를 두지 않아 다음에 다시 묻는다
    async fetchMe() {
      try {
        const res = await axios.get("/api/me", { quietSession: true });
        this.data = res.data;
        this.fetched = true;
      } catch (error) {
        if (error?.response?.status !== 401) return;
        this.data = null;
        this.fetched = true;
      }
    },

    // 세션이 끝난 뒤 다시 로그인했는지 본다. 다른 계정으로 들어왔으면 화면 전체가 남의 것이라 새로 연다
    async resumeSession() {
      try {
        const res = await axios.get("/api/me", { quietSession: true });
        if (this.data && res.data.id !== this.data.id) {
          window.location.reload();
          return false;
        }
        this.data = res.data;
        session.ended = false;
        return true;
      } catch {
        return false;
      }
    },

    // tier가 null이면 해제.
    async setViewAs(tier) {
      await axios.post("/api/admin/view-as", { tier });
      // 계층이 바뀌면 서버 목록·플레이어 상태·버튼 노출이 전부 달라진다. 부분 갱신으로 맞추기보다
      // 통째로 다시 읽는다. 점검용 기능이라 어중간하게 남은 상태가 더 헷갈린다.
      window.location.reload();
    },
  },
});
