<template>
  <div>
    <nav v-if="user.isLoggedIn" class="navbar">
      <router-link to="/servers" class="nav-brand">🎵 MusicBot</router-link>
      <div class="nav-links">
        <router-link to="/servers">서버 목록</router-link>
        <router-link v-if="user.isAdmin" to="/admin">관리자</router-link>
      </div>
      <div class="nav-user">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" alt="avatar" />
        <span>{{ user.displayName }}</span>
        <a href="/auth/logout" class="btn btn-danger" style="padding: 4px 10px; font-size: 0.8rem;">로그아웃</a>
      </div>
    </nav>
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useUserStore } from './stores/user.js'

const user = useUserStore()

onMounted(() => user.fetchMe())
</script>
