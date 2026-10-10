<template>
  <!-- 없는 주소. 서버 화면과 같은 자리에 오류 창 하나 -->
  <div class="w-full max-w-7xl mx-auto h-full flex flex-col p-(--gap-out) pb-[calc(var(--gap-out)+var(--player))] md:pb-(--gap-out)">
    <PageError icon="explore_off" :text="text.shell.notFound">
      <BaseButton variant="secondary" @click="router.push('/servers')"><Icon name="dns" :size="20" />{{ text.common.toServerList }}</BaseButton>
    </PageError>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import PageError from "../components/PageError.vue";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";
import { text } from "../text/index.ts";

const router = useRouter();
</script>
