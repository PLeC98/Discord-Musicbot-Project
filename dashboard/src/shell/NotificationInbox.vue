<template>
  <!-- 알림함 종: 위 막대 오른쪽 끝. 안 읽은 알림이 있으면 수를 단 배지(M3 큰 배지). 누르면 알림 서랍(NoticeDrawer)이 알림함으로 늘어난다 -->
  <button type="button" aria-haspopup="dialog" :aria-expanded="inboxOpen" :aria-label="unread ? T.inboxUnread(unread) : T.inbox" v-tooltip="inboxOpen ? null : T.inbox" :class="[TOPBAR_BTN, inboxOpen && 'bg-on-surface/8']" class="relative" @click="inboxOpen ? closeInbox() : openInbox()">
    <Icon name="notifications" :fill="unread > 0" />
    <span v-if="unread" class="absolute -top-0.5 left-[calc(50%+2px)] h-4 min-w-4 px-1 rounded-full bg-error text-on-error text-2xs leading-4 font-semibold nums text-center">{{ unread > 99 ? "99+" : unread }}</span>
  </button>
</template>

<script setup lang="ts">
import Icon from "../components/BaseIcon.vue";
import { TOPBAR_BTN } from "../utils/topbar.ts";
import { unread, inboxOpen, openInbox, closeInbox } from "../composables/toasts.ts";
import { text } from "../text/index.ts";
const T = text.shell;
</script>
