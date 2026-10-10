import { defineStore } from "pinia";
import axios from "axios";
import { session } from "../composables/session.ts";
import { statusOf } from "../utils/request.ts";
import { TIERS, type Me, type Tier, type ViewAsReply } from "../../../src/dashboard/contract/identity.ts";
import { text } from "../text/index.ts";

// 권한 수준 오버라이드 계층의 이름표. 계층과 차례는 서버의 것(contract/identity 의 TIERS)
const TIER_TEXT: Record<Tier, { label: string; desc: string }> = text.admin.tiers;
// null(해제)은 목록에 넣지 않는다. 선택지가 아니라 "오버라이드 없음"(운영자 그대로) 상태다
export const VIEW_AS_TIERS = TIERS.map((id) => ({ id, ...TIER_TEXT[id] }));

export const useUserStore = defineStore("user", {
  state: () => ({
    data: null as Me | null,
    fetched: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.data,
    // 오버라이드가 반영된 값. UI가 그 계층으로 보이게 한다
    isOwner: (s) => s.data?.isOwner ?? false,
    // 오버라이드와 무관한 실제 값. 해제 수단을 계속 노출하기 위한 것
    isRealOwner: (s) => s.data?.isRealOwner ?? false,
    viewAs: (s) => s.data?.viewAs ?? null,
    viewAsLabel: (s) => (s.data?.viewAs ? TIER_TEXT[s.data.viewAs].label : null),
    displayName: (s) => s.data?.globalName || s.data?.username || "",
    avatarUrl: (s) => s.data?.avatarUrl ?? null,
  },
  actions: {
    // 401 이면 로그인하지 않았다(처음 들어온 사람이라 세션 끝 대화상자는 띄우지 않는다).
    // 그 밖의 실패(응답 없음 · 서버 오류)는 모른다: fetched 를 두지 않아 다음에 다시 묻는다
    async fetchMe() {
      try {
        const res = await axios.get<Me>("/api/me", { quietSession: true });
        this.data = res.data;
        this.fetched = true;
      } catch (error) {
        if (statusOf(error) !== 401) return;
        this.data = null;
        this.fetched = true;
      }
    },

    // 세션이 끝난 뒤 다시 로그인했는지 본다. 다른 계정으로 들어왔으면 화면 전체가 남의 것이라 새로 연다
    async resumeSession() {
      try {
        const res = await axios.get<Me>("/api/me", { quietSession: true });
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
    async setViewAs(tier: Tier | null) {
      await axios.post<ViewAsReply>("/api/admin/view-as", { tier });
      // 계층이 바뀌면 서버 목록·플레이어 상태·버튼 노출이 전부 달라진다. 부분 갱신으로 맞추기보다
      // 통째로 다시 읽는다. 점검용 기능이라 어중간하게 남은 상태가 더 헷갈린다.
      window.location.reload();
    },
  },
});
