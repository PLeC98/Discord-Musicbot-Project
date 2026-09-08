import { createRouter, createWebHistory } from "vue-router";
import { useUserStore } from "../stores/user.js";

const routes = [
  {
    path: "/",
    component: () => import("../views/LoginView.vue"),
  },
  {
    // 로그인 직후/재방문 공통 착지점 — 운영자든 아니든 서버 목록으로 (운영자 패널은 계정 메뉴에서 진입)
    path: "/dashboard",
    redirect: "/servers",
  },
  {
    path: "/servers",
    component: () => import("../views/ServersView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/servers/:guildId",
    component: () => import("../views/ServerView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/servers/:guildId/settings",
    component: () => import("../views/ServerSettingsView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/admin",
    component: () => import("../views/AdminView.vue"),
    meta: { requiresAuth: true, requiresOwner: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const user = useUserStore();
  if (!user.fetched) await user.fetchMe();

  if (to.meta.requiresAuth && !user.isLoggedIn) return "/";
  // 실 운영자 기준 — 서버의 requireOwner와 같다. 권한 수준 오버라이드로 낮춰도 해제 수단이
  // 이 화면 안에 있으므로 여기까지 막으면 스스로를 잠근다.
  if (to.meta.requiresOwner && !user.isRealOwner) return "/servers";
});

export default router;
