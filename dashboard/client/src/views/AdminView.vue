<template>
  <div class="max-w-275 mx-auto px-3 py-4.5">
    <h1 class="pl-2 text-[1.7rem] font-extrabold mb-1.5 tracking-tight bg-linear-135 from-[#e8eaf6] via-[#c4b5fd] via-55% to-[#a78bfa] bg-clip-text text-transparent">관리자 패널</h1>
    <p class="pl-2 text-muted mb-4.5 text-[0.9rem]">10초마다 자동 갱신</p>

    <div v-if="loading" class="flex items-center justify-center p-20 text-muted">불러오는 중...</div>

    <template v-else>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3 gap-y-3 mb-3">
        <!-- Bot -->
        <BaseCard title="🤖 봇 상태">
          <div :class="statRow">
            <span>태그</span><span>{{ s.bot.tag }}</span>
          </div>
          <div :class="statRow">
            <span>서버 수</span><strong>{{ s.bot.guilds }}</strong>
          </div>
          <div :class="statRow">
            <span>활성 플레이어</span><strong>{{ s.activePlayers }}</strong>
          </div>
          <div :class="statRow">
            <span>WebSocket 핑</span><span :class="pingClass(s.bot.ping)">{{ s.bot.ping }} ms</span>
          </div>
          <div :class="statRow">
            <span>업타임</span><span>{{ uptimeStr }}</span>
          </div>
        </BaseCard>

        <!-- Node.js -->
        <BaseCard title="⚙️ Node.js">
          <div :class="statRow">
            <span>버전</span><span>{{ s.node.version }}</span>
          </div>
          <div :class="statRow">
            <span>플랫폼</span><span>{{ s.node.platform }} / {{ s.node.arch }}</span>
          </div>
          <div :class="statRow">
            <span>Heap 사용</span><span>{{ s.node.memory.heapUsed }} MB / {{ s.node.memory.heapTotal }} MB</span>
          </div>
          <div :class="statRow">
            <span>RSS</span><span>{{ s.node.memory.rss }} MB</span>
          </div>
        </BaseCard>

        <!-- System -->
        <BaseCard title="🖥️ 시스템">
          <div :class="statRow">
            <span>CPU 코어</span><span>{{ s.system.cpus }} 코어</span>
          </div>
          <div :class="statRow">
            <span>여유 메모리</span><span>{{ s.system.freeMem }} MB / {{ s.system.totalMem }} MB</span>
          </div>
          <div :class="statRow" v-if="s.system.loadAvg">
            <span>로드 평균</span>
            <span>{{ s.system.loadAvg.map((n) => n.toFixed(2)).join(" · ") }}</span>
          </div>
        </BaseCard>

        <!-- Shard -->
        <BaseCard v-if="s.shards" title="🔀 샤드">
          <div :class="statRow">
            <span>샤드 ID</span><span>{{ s.shards.ids?.join(", ") }}</span>
          </div>
          <div :class="statRow">
            <span>총 샤드 수</span><span>{{ s.shards.count }}</span>
          </div>
        </BaseCard>
      </div>

      <!-- Broadcast -->
      <BaseCard title="📢 전체 공지 발송" class="mb-3">
        <p class="text-muted text-sm mb-4">봇이 들어간 모든 서버에 공지 메시지를 보냅니다.</p>

        <div class="flex gap-2 mb-3.5 flex-wrap">
          <button v-for="type in types" :key="type.value" :class="typeBtn(bType === type.value)" @click="bType = type.value">{{ type.label }}</button>
        </div>

        <textarea v-model="bMsg" placeholder="공지 내용을 입력하세요..." rows="4" class="w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-3 text-[0.9rem] resize-y outline-none mb-3.5 font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7"></textarea>

        <BaseButton variant="primary" @click="broadcast" :disabled="sending || !bMsg.trim()">
          {{ sending ? "발송 중..." : "전체 발송" }}
        </BaseButton>

        <div v-if="result" :class="resultMsg(result.success)">
          {{ result.success ? `✅ ${result.sent}개 서버 발송 완료 (실패: ${result.failed})` : "❌ 발송 실패" }}
        </div>
      </BaseCard>

      <!-- Log viewer -->
      <BaseCard class="mb-3">
        <div class="flex justify-between items-center flex-wrap gap-2.5 mb-2.5">
          <span :class="cardTitle" class="mb-0!">📋 실시간 로그</span>
          <div class="flex gap-1.5 flex-wrap">
            <button v-for="lvl in logLevels" :key="lvl.value" :class="typeBtn(logFilter === lvl.value)" @click="logFilter = logFilter === lvl.value ? null : lvl.value">{{ lvl.label }}</button>
            <button :class="typeBtn(autoScroll)" @click="autoScroll = !autoScroll">
              {{ autoScroll ? "⏬ 자동" : "⏸ 정지" }}
            </button>
            <button :class="typeBtn(false)" @click="logs = []">지우기</button>
          </div>
        </div>
        <div class="flex items-center gap-1.5 text-[0.8rem] text-muted mb-2">
          <span :class="sseConnected ? 'text-success' : 'text-danger'">●</span>
          <span>{{ sseConnected ? "연결됨" : "연결 끊김" }}</span>
          <span class="ml-auto">{{ filteredLogs.length }}줄</span>
        </div>
        <div class="h-95 overflow-y-auto bg-black/35 rounded-[10px] border border-white/7 px-3 py-2 font-mono text-[0.78rem]" ref="logPane" @scroll="onLogScroll">
          <div v-if="filteredLogs.length === 0" class="text-muted text-center py-10">로그 없음</div>
          <div v-for="(entry, i) in filteredLogs" :key="i" class="flex gap-2 leading-relaxed border-b border-white/3">
            <span class="text-[#6b7280] shrink-0">{{ fmtTime(entry.ts) }}</span>
            <span class="shrink-0 w-10 font-bold" :class="lvColor(entry.level)">{{ entry.level.toUpperCase() }}</span>
            <span class="break-all whitespace-pre-wrap" :class="txtColor(entry.level)">{{ entry.text }}</span>
          </div>
        </div>
      </BaseCard>

      <!-- Guild management -->
      <BaseCard title="🌐 참가 서버 관리" class="mb-3">
        <p class="text-muted text-sm mb-4">봇이 참가 중인 서버 목록입니다. 나가기는 되돌릴 수 없으며, 다시 사용하려면 재초대해야 합니다.</p>

        <div v-if="guilds.length === 0" class="text-muted text-sm">참가 중인 서버가 없습니다.</div>
        <div v-else class="flex flex-col max-h-80 overflow-y-auto [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]">
          <div v-for="g in guilds" :key="g.id" class="flex items-center gap-3 py-2.5 pr-2 border-b border-white/7 last:border-b-0 last:pb-0">
            <img v-if="g.icon" :src="g.icon" :alt="g.name" class="size-9 rounded-full border border-white/10 shrink-0" />
            <div v-else class="size-9 rounded-full border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold flex items-center justify-center shrink-0">{{ g.name[0] }}</div>
            <div class="flex-1 overflow-hidden">
              <div class="text-sm font-semibold overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</div>
              <div class="text-[0.78rem] text-muted">멤버 {{ g.memberCount }}명<span v-if="g.hasPlayer" class="text-success"> · 🎵 재생 중</span></div>
            </div>
            <BaseButton variant="ghost" size="sm" @click="leaveTarget = g">나가기</BaseButton>
          </div>
        </div>

        <div v-if="leaveResult" :class="resultMsg(leaveResult.success)">
          {{ leaveResult.success ? `✅ "${leaveResult.name}" 서버에서 나갔습니다` : `❌ 나가기 실패: ${leaveResult.error}` }}
        </div>
      </BaseCard>

      <!-- Command redeploy -->
      <BaseCard title="🔁 슬래시 커맨드 재배포">
        <p class="text-muted text-sm mb-4">현재 로드된 슬래시 커맨드를 Discord에 다시 등록합니다. 봇 재시작 없이 실행됩니다.</p>

        <BaseButton variant="primary" @click="redeploy" :disabled="redeploying">
          {{ redeploying ? "재배포 중..." : "커맨드 재배포" }}
        </BaseButton>

        <div v-if="redeployResult" :class="resultMsg(redeployResult.success)">
          {{ redeployResult.success ? `✅ ${redeployResult.count}개 커맨드 ${redeployResult.scope === "guild" ? "길드" : "전역"} 배포 완료` : `❌ 재배포 실패: ${redeployResult.error || ""}` }}
        </div>
      </BaseCard>
    </template>

    <!-- Leave confirm dialog -->
    <div v-if="leaveTarget" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200" @click.self="leaveTarget = null">
      <div class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 max-w-95 w-[90%] text-center shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-2 text-[0.95rem] text-fg-soft">
          <strong class="text-fg">{{ leaveTarget.name }}</strong> 서버에서 나갈까요?
        </p>
        <p class="mb-5.5 text-[0.82rem] text-muted">
          되돌릴 수 없으며, 다시 사용하려면 재초대해야 합니다.<span v-if="leaveTarget.hasPlayer"><br />🎵 이 서버는 현재 재생 중이며, 재생이 중단됩니다.</span>
        </p>
        <div class="flex gap-2.5 justify-center">
          <BaseButton variant="ghost" :disabled="leaving" @click="leaveTarget = null">취소</BaseButton>
          <BaseButton variant="danger" :disabled="leaving" @click="leaveGuild">
            {{ leaving ? "나가는 중..." : "나가기" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";

// ── 반복 유틸리티 클래스 ─────────────────────────────────────
const statRow = "flex justify-between items-center py-2.5 border-b border-white/7 text-sm last:border-b-0 last:pb-0 [&>span:first-child]:text-muted [&>strong]:font-semibold [&>span:last-child]:font-semibold";
const cardTitle = "text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-3.5";

// 필터/타입 알약 버튼 — active 여부에 따라 색상군을 통째로 교체(같은 속성 유틸리티 중복 회피)
function typeBtn(active) {
  const base = "px-4 py-1.5 rounded-[20px] border cursor-pointer text-[0.83rem] font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-spring hover:-translate-y-px";
  return active ? `${base} border-accent/55 text-[#c4b5fd] bg-accent/16 shadow-[0_0_10px_rgba(124,111,246,0.2)]` : `${base} border-white/9 bg-white/5 text-muted hover:bg-white/9 hover:text-fg`;
}

function resultMsg(ok) {
  const base = "mt-3 px-4 py-2.5 rounded-[10px] text-sm border";
  return ok ? `${base} bg-success/10 text-success border-success/22` : `${base} bg-danger/10 text-danger border-danger/22`;
}

const loading = ref(true);
const s = ref({
  bot: { tag: "", guilds: 0, ping: 0, status: 0, uptime: { days: 0, hours: 0, minutes: 0, seconds: 0 } },
  node: { version: "", platform: "", arch: "", memory: { heapUsed: 0, heapTotal: 0, rss: 0 } },
  system: { cpus: 0, totalMem: 0, freeMem: 0, loadAvg: [] },
  shards: null,
  activePlayers: 0,
});

const bType = ref("maintenance");
const bMsg = ref("");
const sending = ref(false);
const result = ref(null);

const types = [
  { value: "maintenance", label: "🔧 점검" },
  { value: "update", label: "🆕 업데이트" },
  { value: "alert", label: "⚠️ 긴급" },
  { value: "info", label: "ℹ️ 공지" },
];

function pingClass(p) {
  if (p < 100) return "text-success";
  if (p < 300) return "text-warning";
  return "text-danger";
}

const uptimeStr = computed(() => {
  const u = s.value.bot.uptime;
  const parts = [];
  if (u.days) parts.push(`${u.days}일`);
  if (u.hours) parts.push(`${u.hours}시간`);
  if (u.minutes) parts.push(`${u.minutes}분`);
  parts.push(`${u.seconds}초`);
  return parts.join(" ");
});

async function fetchStatus() {
  try {
    const res = await axios.get("/api/admin/status");
    s.value = res.data;
    loading.value = false;
  } catch {
    loading.value = false;
  }
}

async function broadcast() {
  if (!bMsg.value.trim() || sending.value) return;
  sending.value = true;
  result.value = null;
  try {
    const res = await axios.post("/api/admin/broadcast", { message: bMsg.value, type: bType.value });
    result.value = res.data;
    if (res.data.success) bMsg.value = "";
  } catch {
    result.value = { success: false };
  } finally {
    sending.value = false;
  }
}

// ── Guild management ─────────────────────────────────────────
const guilds = ref([]);
const leaveTarget = ref(null); // 확인 모달에 표시 중인 서버 (null이면 닫힘)
const leaving = ref(false);
const leaveResult = ref(null);

async function fetchGuilds() {
  try {
    const res = await axios.get("/api/admin/guilds");
    guilds.value = res.data.guilds;
  } catch {
    // 일시 오류는 무시 — 다음 폴링에서 회복
  }
}

async function leaveGuild() {
  const g = leaveTarget.value;
  if (!g || leaving.value) return;
  leaving.value = true;
  leaveResult.value = null;
  try {
    await axios.post(`/api/admin/guilds/${g.id}/leave`);
    leaveResult.value = { success: true, name: g.name };
    await Promise.all([fetchGuilds(), fetchStatus()]);
  } catch (e) {
    leaveResult.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    leaving.value = false;
    leaveTarget.value = null;
  }
}

// ── Command redeploy ─────────────────────────────────────────
const redeploying = ref(false);
const redeployResult = ref(null);

async function redeploy() {
  if (redeploying.value) return;
  redeploying.value = true;
  redeployResult.value = null;
  try {
    const res = await axios.post("/api/admin/redeploy-commands");
    redeployResult.value = res.data;
  } catch (e) {
    redeployResult.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    redeploying.value = false;
  }
}

// ── Log viewer ──────────────────────────────────────────────
const logs = ref([]);
const logFilter = ref(null);
const autoScroll = ref(true);
const sseConnected = ref(false);
const logPane = ref(null);
let sse = null;

const logLevels = [
  { value: "log", label: "LOG" },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" },
];

// 로그 레벨별 색 (구 .lvl-* .log-lv / .log-txt)
function lvColor(level) {
  return { log: "text-[#9ca3af]", info: "text-[#60a5fa]", warn: "text-[#fbbf24]", error: "text-[#f87171]" }[level] || "text-[#9ca3af]";
}
function txtColor(level) {
  return { warn: "text-[#fef3c7]", error: "text-[#fecaca]" }[level] || "text-[#d1d5db]";
}

const filteredLogs = computed(() => (logFilter.value ? logs.value.filter((e) => e.level === logFilter.value) : logs.value));

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function onLogScroll() {
  if (!logPane.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logPane.value;
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50;
}

watch(
  () => logs.value.length,
  () => {
    if (autoScroll.value)
      nextTick(() => {
        if (logPane.value) logPane.value.scrollTop = logPane.value.scrollHeight;
      });
  },
);

function connectSSE() {
  sse = new EventSource("/api/admin/logs/stream", { withCredentials: true });
  sse.onopen = () => {
    sseConnected.value = true;
  };
  sse.onmessage = (e) => {
    const entry = JSON.parse(e.data);
    logs.value.push(entry);
    if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500);
  };
  sse.onerror = () => {
    sseConnected.value = false;
  };
}

// ── Lifecycle ────────────────────────────────────────────────
let timer = null;
onMounted(() => {
  fetchStatus();
  fetchGuilds();
  timer = setInterval(() => {
    fetchStatus();
    fetchGuilds();
  }, 10000);
  connectSSE();
});
onUnmounted(() => {
  clearInterval(timer);
  if (sse) sse.close();
});
</script>
