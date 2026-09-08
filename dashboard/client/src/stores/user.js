import { defineStore } from "pinia";
import axios from "axios";

// 권한 수준 오버라이드 계층 — 서버 dashboard/server/viewAs.js의 TIERS와 순서·키를 맞춘다.
// null(해제)은 목록에 넣지 않는다 — 선택지가 아니라 "오버라이드 없음" 상태다.
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
    // 오버라이드가 반영된 값 — UI가 그 계층으로 보이게 한다
    isOwner: (s) => s.data?.isOwner ?? false,
    // 오버라이드와 무관한 실제 값 — 해제 수단을 계속 노출하기 위한 것
    isRealOwner: (s) => s.data?.isRealOwner ?? false,
    viewAs: (s) => s.data?.viewAs ?? null,
    viewAsLabel: (s) => VIEW_AS_TIERS.find((t) => t.id === s.data?.viewAs)?.label ?? null,
    displayName: (s) => s.data?.globalName || s.data?.username || "",
    avatarUrl: (s) => (s.data?.avatar ? `https://cdn.discordapp.com/avatars/${s.data.id}/${s.data.avatar}.webp?size=64` : null),
  },
  actions: {
    async fetchMe() {
      try {
        const res = await axios.get("/api/me");
        this.data = res.data;
      } catch {
        this.data = null;
      } finally {
        this.fetched = true;
      }
    },

    // tier가 null이면 해제.
    async setViewAs(tier) {
      await axios.post("/api/admin/view-as", { tier });
      // 계층이 바뀌면 서버 목록·플레이어 상태·버튼 노출이 전부 달라진다. 부분 갱신으로 맞추기보다
      // 통째로 다시 읽는다 — 점검용 기능이라 어중간하게 남은 상태가 더 헷갈린다.
      window.location.reload();
    },
  },
});
