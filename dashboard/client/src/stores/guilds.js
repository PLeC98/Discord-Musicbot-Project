import { defineStore } from 'pinia'
import axios from 'axios'

// SSE/타이머 핸들은 반응성이 필요 없으므로 모듈 스코프에 둔다
let subscribers = 0
let timer = null
let eventSource = null
let nudgeTimer = null

// 상호(유저∩봇) 서버 목록 — 사이드바와 서버 목록 화면(ServersView)이 공유.
// 구독 카운팅으로 SSE·폴링을 단일화: 첫 구독자가 연결을 열고, 마지막 구독자가 닫는다.
export const useGuildsStore = defineStore('guilds', {
    state: () => ({
        guilds: [],
        loading: true
    }),
    actions: {
        async refresh() {
            try {
                const res = await axios.get('/api/guilds')
                this.guilds = res.data.guilds
            } catch {
                // 일시적 오류는 무시 — 다음 폴링/넛지에서 회복
            } finally {
                this.loading = false
            }
        },

        // 재생 상태는 이벤트성 → SSE 넛지로 즉시 갱신(사용자 단위 멀티플렉스).
        // 목록 구성(어느 서버냐)은 드무니 느린 폴백 폴링으로.
        subscribe() {
            if (++subscribers > 1) return
            this.refresh()
            eventSource = new EventSource('/api/guilds/events', { withCredentials: true })
            eventSource.onmessage = () => {
                clearTimeout(nudgeTimer)
                nudgeTimer = setTimeout(() => this.refresh(), 150)
            }
            timer = setInterval(() => this.refresh(), 30000) // 폴백 — 새 참가 서버 반영 + SSE 끊김 안전망
        },

        unsubscribe() {
            if (--subscribers > 0) return
            clearInterval(timer)
            clearTimeout(nudgeTimer)
            if (eventSource) eventSource.close()
            eventSource = null
            this.loading = true // 다음 첫 구독 때 로딩 표시부터 시작
        }
    }
})
