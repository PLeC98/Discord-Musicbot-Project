import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user.js'

const routes = [
    {
        path: '/',
        component: () => import('../views/LoginView.vue')
    },
    {
        path: '/dashboard',
        redirect: () => {
            const user = useUserStore()
            return user.isAdmin ? '/admin' : '/servers'
        }
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
