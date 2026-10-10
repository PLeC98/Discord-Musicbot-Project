<template>
  <!-- 없는 주소. 서버 화면과 같은 자리에 오류 창 하나 -->
  <div class="w-full max-w-7xl mx-auto h-full flex flex-col p-(--gap-out) pb-[calc(var(--gap-out)+var(--player))] md:pb-(--gap-out)">
    <PageError icon="explore_off" :text="'페이지를 찾을 수 없어요!\n주소가 잘못되었거나 없어진 페이지예요.'">
      <BaseButton variant="secondary" @click="router.push('/servers')"><Icon name="dns" :size="20" />서버 목록으로</BaseButton>
    </PageError>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import PageError from "../components/PageError.vue";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";

const router = useRouter();
</script>
