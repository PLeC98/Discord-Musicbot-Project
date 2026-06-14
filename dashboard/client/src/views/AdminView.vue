<template>
  <div class="page">
    <h1 class="page-title">관리자 패널</h1>
    <p class="page-subtitle">10초마다 자동 갱신</p>

    <div v-if="loading" class="loading">불러오는 중...</div>

    <template v-else>
      <div class="status-grid">

        <!-- Bot -->
        <div class="card">
          <div class="card-title">🤖 봇 상태</div>
          <div class="stat-rows">
            <div class="stat-row"><span>태그</span><span>{{ s.bot.tag }}</span></div>
            <div class="stat-row"><span>서버 수</span><strong>{{ s.bot.guilds }}</strong></div>
            <div class="stat-row"><span>활성 플레이어</span><strong>{{ s.activePlayers }}</strong></div>
            <div class="stat-row"><span>WebSocket 핑</span><span :class="pingClass(s.bot.ping)">{{ s.bot.ping }} ms</span></div>
            <div class="stat-row"><span>업타임</span><span>{{ uptimeStr }}</span></div>
          </div>
        </div>

        <!-- Node.js -->
        <div class="card">
          <div class="card-title">⚙️ Node.js</div>
          <div class="stat-rows">
            <div class="stat-row"><span>버전</span><span>{{ s.node.version }}</span></div>
            <div class="stat-row"><span>플랫폼</span><span>{{ s.node.platform }} / {{ s.node.arch }}</span></div>
            <div class="stat-row"><span>Heap 사용</span><span>{{ s.node.memory.heapUsed }} MB / {{ s.node.memory.heapTotal }} MB</span></div>
            <div class="stat-row"><span>RSS</span><span>{{ s.node.memory.rss }} MB</span></div>
          </div>
        </div>

        <!-- System -->
        <div class="card">
          <div class="card-title">🖥️ 시스템</div>
          <div class="stat-rows">
            <div class="stat-row"><span>CPU 코어</span><span>{{ s.system.cpus }} 코어</span></div>
            <div class="stat-row"><span>여유 메모리</span><span>{{ s.system.freeMem }} MB / {{ s.system.totalMem }} MB</span></div>
            <div class="stat-row" v-if="s.system.loadAvg">
              <span>로드 평균</span>
              <span>{{ s.system.loadAvg.map(n => n.toFixed(2)).join(' · ') }}</span>
            </div>
          </div>
        </div>

        <!-- Shard -->
        <div class="card" v-if="s.shards">
          <div class="card-title">🔀 샤드</div>
          <div class="stat-rows">
            <div class="stat-row"><span>샤드 ID</span><span>{{ s.shards.ids?.join(', ') }}</span></div>
            <div class="stat-row"><span>총 샤드 수</span><span>{{ s.shards.count }}</span></div>
          </div>
        </div>

      </div>

      <!-- Log viewer -->
      <div class="card log-card">
        <div class="log-header">
          <span class="card-title">📋 실시간 로그</span>
          <div class="log-controls">
            <button
              v-for="lvl in logLevels"
              :key="lvl.value"
              :class="['type-btn', { active: logFilter === lvl.value }]"
              @click="logFilter = logFilter === lvl.value ? null : lvl.value"
            >{{ lvl.label }}</button>
            <button class="type-btn" :class="{ active: autoScroll }" @click="autoScroll = !autoScroll">
              {{ autoScroll ? '⏬ 자동' : '⏸ 정지' }}
            </button>
            <button class="type-btn" @click="logs = []">지우기</button>
          </div>
        </div>
        <div class="log-meta">
          <span :class="['sse-dot', sseConnected ? 'on' : 'off']">●</span>
          <span class="sse-label">{{ sseConnected ? '연결됨' : '연결 끊김' }}</span>
          <span class="log-count">{{ filteredLogs.length }}줄</span>
        </div>
        <div class="log-pane" ref="logPane" @scroll="onLogScroll">
          <div v-if="filteredLogs.length === 0" class="log-empty">로그 없음</div>
          <div
            v-for="(entry, i) in filteredLogs"
            :key="i"
            :class="['log-line', `lvl-${entry.level}`]"
          >
            <span class="log-ts">{{ fmtTime(entry.ts) }}</span>
            <span class="log-lv">{{ entry.level.toUpperCase() }}</span>
            <span class="log-txt">{{ entry.text }}</span>
          </div>
        </div>
      </div>

      <!-- Broadcast -->
      <div class="card broadcast-card">
        <div class="card-title">📢 전체 공지 발송</div>
        <p class="broadcast-desc">봇이 들어간 모든 서버에 공지 메시지를 보냅니다.</p>

        <div class="type-row">
          <button
            v-for="type in types"
            :key="type.value"
            :class="['type-btn', { active: bType === type.value }]"
            @click="bType = type.value"
          >{{ type.label }}</button>
        </div>

        <textarea
          v-model="bMsg"
          placeholder="공지 내용을 입력하세요..."
          rows="4"
          class="broadcast-input"
        ></textarea>

        <button class="btn btn-primary" @click="broadcast" :disabled="sending || !bMsg.trim()">
          {{ sending ? '발송 중...' : '전체 발송' }}
        </button>

        <div v-if="result" class="result-msg" :class="result.success ? 'ok' : 'err'">
          {{ result.success
            ? `✅ ${result.sent}개 서버 발송 완료 (실패: ${result.failed})`
            : '❌ 발송 실패' }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const loading = ref(true)
const s = ref({
  bot: { tag: '', guilds: 0, ping: 0, status: 0, uptime: { days: 0, hours: 0, minutes: 0, seconds: 0 } },
  node: { version: '', platform: '', arch: '', memory: { heapUsed: 0, heapTotal: 0, rss: 0 } },
  system: { cpus: 0, totalMem: 0, freeMem: 0, loadAvg: [] },
  shards: null,
  activePlayers: 0
})

const bType = ref('maintenance')
const bMsg = ref('')
const sending = ref(false)
const result = ref(null)

const types = [
  { value: 'maintenance', label: '🔧 점검' },
  { value: 'update',      label: '🆕 업데이트' },
  { value: 'alert',       label: '⚠️ 긴급' },
  { value: 'info',        label: 'ℹ️ 공지' }
]

function pingClass(p) {
  if (p < 100) return 'good'
  if (p < 300) return 'ok'
  return 'bad'
}

const uptimeStr = computed(() => {
  const u = s.value.bot.uptime
  const parts = []
  if (u.days)    parts.push(`${u.days}일`)
  if (u.hours)   parts.push(`${u.hours}시간`)
  if (u.minutes) parts.push(`${u.minutes}분`)
  parts.push(`${u.seconds}초`)
  return parts.join(' ')
})

async function fetchStatus() {
  try {
    const res = await axios.get('/api/admin/status')
    s.value = res.data
    loading.value = false
  } catch { loading.value = false }
}

async function broadcast() {
  if (!bMsg.value.trim() || sending.value) return
  sending.value = true
  result.value = null
  try {
    const res = await axios.post('/api/admin/broadcast', { message: bMsg.value, type: bType.value })
    result.value = res.data
    if (res.data.success) bMsg.value = ''
  } catch { result.value = { success: false } }
  finally { sending.value = false }
}

// ── Log viewer ──────────────────────────────────────────────
const logs = ref([])
const logFilter = ref(null)
const autoScroll = ref(true)
const sseConnected = ref(false)
const logPane = ref(null)
let sse = null

const logLevels = [
  { value: 'log',   label: 'LOG' },
  { value: 'info',  label: 'INFO' },
  { value: 'warn',  label: 'WARN' },
  { value: 'error', label: 'ERROR' },
]

const filteredLogs = computed(() =>
  logFilter.value ? logs.value.filter(e => e.level === logFilter.value) : logs.value
)

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function onLogScroll() {
  if (!logPane.value) return
  const { scrollTop, scrollHeight, clientHeight } = logPane.value
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50
}

watch(() => logs.value.length, () => {
  if (autoScroll.value) nextTick(() => {
    if (logPane.value) logPane.value.scrollTop = logPane.value.scrollHeight
  })
})

function connectSSE() {
  sse = new EventSource('/api/admin/logs/stream', { withCredentials: true })
  sse.onopen = () => { sseConnected.value = true }
  sse.onmessage = (e) => {
    const entry = JSON.parse(e.data)
    logs.value.push(entry)
    if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500)
  }
  sse.onerror = () => { sseConnected.value = false }
}

// ── Lifecycle ────────────────────────────────────────────────
let timer = null
onMounted(() => { fetchStatus(); timer = setInterval(fetchStatus, 10000); connectSSE() })
onUnmounted(() => { clearInterval(timer); if (sse) sse.close() })
</script>

<style scoped>
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.stat-rows { display: flex; flex-direction: column; gap: 0; }

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 0.875rem;
}

.stat-row:last-child { border-bottom: none; padding-bottom: 0; }

.stat-row > span:first-child { color: var(--text-muted); }
.stat-row strong, .stat-row span:last-child { font-weight: 600; }

.good { color: var(--success); }
.ok   { color: var(--warning); }
.bad  { color: var(--danger); }

/* Log viewer */
.log-card { margin-bottom: 14px; }

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}
.log-header .card-title { margin: 0; }

.log-controls { display: flex; gap: 6px; flex-wrap: wrap; }

.log-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.sse-dot.on  { color: var(--success); }
.sse-dot.off { color: var(--danger); }
.log-count { margin-left: auto; }

.log-pane {
  height: 380px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  padding: 8px 12px;
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 0.78rem;
}

.log-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 40px 0;
}

.log-line {
  display: flex;
  gap: 8px;
  line-height: 1.6;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.log-ts  { color: #6b7280; flex-shrink: 0; }
.log-lv  { flex-shrink: 0; width: 40px; font-weight: 700; }
.log-txt { color: #d1d5db; word-break: break-all; white-space: pre-wrap; }

.lvl-log   .log-lv { color: #9ca3af; }
.lvl-info  .log-lv { color: #60a5fa; }
.lvl-warn  .log-lv { color: #fbbf24; }
.lvl-error .log-lv { color: #f87171; }
.lvl-warn  .log-txt { color: #fef3c7; }
.lvl-error .log-txt { color: #fecaca; }

/* Broadcast */
.broadcast-desc {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-bottom: 16px;
}

.type-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }

.type-btn {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.83rem;
  font-weight: 500;
  transition:
    transform 0.3s var(--spring),
    background 0.2s,
    border-color 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}
.type-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--text-primary);
  transform: translateY(-1px);
}
.type-btn.active {
  border-color: rgba(124, 111, 246, 0.55);
  color: #c4b5fd;
  background: rgba(124, 111, 246, 0.16);
  box-shadow: 0 0 10px rgba(124, 111, 246, 0.20);
}

.broadcast-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  color: var(--text-primary);
  padding: 12px 14px;
  font-size: 0.9rem;
  resize: vertical;
  outline: none;
  margin-bottom: 14px;
  font-family: inherit;
  transition: border-color 0.2s, background 0.2s;
}
.broadcast-input:focus {
  border-color: rgba(124, 111, 246, 0.55);
  background: rgba(255, 255, 255, 0.07);
}

.result-msg {
  margin-top: 12px;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 0.875rem;
}

.result-msg.ok  { background: rgba(74,  222, 128, 0.10); color: var(--success); border: 1px solid rgba(74,  222, 128, 0.22); }
.result-msg.err { background: rgba(248, 113, 113, 0.10); color: var(--danger);  border: 1px solid rgba(248, 113, 113, 0.22); }
</style>
