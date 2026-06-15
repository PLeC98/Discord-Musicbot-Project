<template>
  <div class="page">
    <h1 class="page-title">서버 목록</h1>
    <p class="page-subtitle">재생 상태와 재생 목록을 관리할 서버를 선택하고, Discord와 실시간 동기화하세요.</p>

    <div v-if="loading" class="loading">불러오는 중...</div>

    <div v-else-if="guilds.length === 0" class="empty-state">
      <div class="empty-icon">🎵</div>
      <p>사용자가 참가한 서버 중에 봇이 함께 있는 서버가 없습니다.</p>
      <p style="font-size: 0.85rem; color: var(--text-muted)">봇을 서버에 초대하거나, 봇이 있는 서버에 참여하세요.</p>
    </div>

    <div v-else class="guild-grid">
      <router-link v-for="g in guilds" :key="g.id" :to="`/servers/${g.id}`" class="guild-card">
        <div class="guild-icon-wrap">
          <img v-if="g.icon" :src="g.icon" :alt="g.name" class="guild-icon" />
          <div v-else class="guild-icon-fallback">{{ g.name[0] }}</div>
        </div>
        <div class="guild-info">
          <div class="guild-name">{{ g.name }}</div>
          <div class="guild-player" :class="g.hasPlayer ? 'active' : 'idle'">
            {{ g.hasPlayer ? "🎵 재생 중" : "⏸ 대기 중" }}
          </div>
        </div>
        <span class="guild-arrow">›</span>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import axios from "axios";

const guilds = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await axios.get("/api/guilds");
    guilds.value = res.data.guilds;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.guild-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.guild-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(12, 16, 36, 0.62);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 10px 18px;
  text-decoration: none;
  color: var(--text-primary);
  box-shadow:
    0 2px 14px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition:
    border-color 0.25s var(--ease-out),
    transform 0.35s var(--spring),
    box-shadow 0.25s var(--ease-out);
}

.guild-card:hover {
  border-color: rgba(124, 111, 246, 0.45);
  transform: translateY(-3px) scale(1.01);
  box-shadow:
    0 12px 36px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(124, 111, 246, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.guild-icon-wrap {
  flex-shrink: 0;
}

.guild-icon,
.guild-icon-fallback {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.1);
  margin-top: 4px;
}

.guild-icon-fallback {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 700;
}

.guild-info {
  flex: 1;
  overflow: hidden;
}

.guild-name {
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 3px;
}

.guild-player {
  font-size: 0.78rem;
  margin-bottom: 4px;
}
.guild-player.active {
  color: var(--success);
}
.guild-player.idle {
  color: var(--text-muted);
}

.guild-arrow {
  color: var(--text-muted);
  font-size: 1.2rem;
  margin-bottom: 6px;
  transition:
    transform 0.3s var(--spring),
    color 0.2s;
}

.guild-card:hover .guild-arrow {
  transform: translateX(4px);
  color: rgba(196, 181, 253, 0.8);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 12px;
}
.empty-state p {
  margin-bottom: 6px;
}
</style>
