import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useUserStore } from "../stores/user.ts";
import { session } from "../composables/session.ts";

declare module "vue-router" {
  interface RouteMeta {
    /** 로그인해야 들어간다 */
    requiresAuth?: boolean;
    /** 봇 운영자만(실 운영자 기준) */
    requiresOwner?: boolean;
    /** 그 서버의 재생 화면이다. 그 서버를 듣고 있으면 재생 바가 숨고 상태는 이 화면이 받는다(같은 서버의 설정 화면은 아니다) */
    playerPage?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("../views/LoginView.vue"),
  },
  {
    // 로그인 직후/재방문 공통 착지점. 운영자든 아니든 서버 목록으로 (운영자 패널은 계정 메뉴에서 진입)
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
    meta: { requiresAuth: true, playerPage: true },
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
  // 로그인했는지 모른다(봇에 닿지 않았다). 로그인 화면으로 보내지 않고 머문다. 다시 시도는 SessionNotice
  if (!user.fetched) {
    session.offline = true;
    return false;
  }
  // 세션이 끝났으면 옮기기 전에 다시 로그인했는지 본다. 아직이면 머문다(대화상자가 떠 있다)
  if (session.ended && to.meta.requiresAuth && !(await user.resumeSession())) return false;

  if (to.meta.requiresAuth && !user.isLoggedIn) return "/";
  // 실 운영자 기준. 서버의 requireOwner와 같다. 권한 수준 오버라이드로 낮춰도 해제 수단이
  // 이 화면 안에 있으므로 여기까지 막으면 스스로를 잠근다.
  if (to.meta.requiresOwner && !user.isRealOwner) return "/servers";
});

export default router;
