import { defineStore } from "pinia";
import axios from "axios";

export const useUserStore = defineStore("user", {
  state: () => ({
    data: null,
    fetched: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.data,
    isOwner: (s) => s.data?.isOwner ?? false,
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
  },
});
