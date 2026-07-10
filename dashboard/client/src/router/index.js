import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user.js'

const routes = [
    {
        path: '/',
        component: () => import('../views/LoginView.vue')
    },
    {
        // 로그인 직후/재방문 공통 착지점 — 관리자든 아니든 서버 목록으로 (관리자 패널은 네비바에서 진입)
        path: '/dashboard',
        redirect: '/servers'
    },
    {
        path: '/servers',
        component: () => import('../views/ServersView.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/servers/:guildId',
        component: () => import('../views/ServerView.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/servers/:guildId/settings',
        component: () => import('../views/ServerSettingsView.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin',
        component: () => import('../views/AdminView.vue'),
        meta: { requiresAuth: true, requiresAdmin: true }
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

router.beforeEach(async (to) => {
    const user = useUserStore()
    if (!user.fetched) await user.fetchMe()

    if (to.meta.requiresAuth && !user.isLoggedIn) return '/'
    if (to.meta.requiresAdmin && !user.isAdmin) return '/servers'
})

export default router
