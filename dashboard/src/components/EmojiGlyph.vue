<!--
  이모지 하나를 size × size 정사각형 칸에 그린다(선택기 칸, 장르 이모지, 이모지 버튼).

  유니코드 이모지는 글자로 그리고 모양은 맨 앞의 Musicbot Twemoji 글꼴이 정한다(twemoji.css, iOS 는 기기 이모지). 부모가 고정폭 글꼴이어도
  Twemoji 로 그리게 font-sans 를 직접 건다. 칸 크기를 정해 두어 글꼴이 오기 전(font-display: block)에도 자리가 같다.

  키캡(1️⃣ #️⃣ *️⃣)만 SVG 그림이다. 글꼴이 숫자, #, * 를 들고 있으면 본문의 숫자까지 이모지 글꼴 것으로 바뀌어 글꼴에서 뺐다.
  iOS 는 키캡도 기기 이모지라 그림 대신 글자를 보인다(-webkit-touch-callout 은 iOS 의 WebKit 에만 있다, twemoji.css 와 같은 판정).

  앱 이모지 토큰(<:이름:id>)이면 봇이 내주는 그 이미지(움직이는 것은 움직인다). 앱에 없는 토큰(지운 이모지)은 경고 아이콘.
-->
<template>
  <span class="inline-flex shrink-0 items-center justify-center font-sans leading-none select-none" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size}px` }">
    <template v-if="token">
      <img v-if="app" :src="appEmojiImage(app)" :alt="`:${app.name}:`" :width="size" :height="size" class="block" draggable="false" />
      <Icon v-else name="error" :size="size" class="text-error" v-tooltip="text.fields.appEmojiMissing" />
    </template>
    <template v-else>
      <img v-if="keycap" :src="keycap" :alt="char" :width="size" :height="size" class="block supports-[-webkit-touch-callout:none]:hidden" draggable="false" />
      <span :class="keycap && 'hidden supports-[-webkit-touch-callout:none]:inline'">{{ char }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import Icon from "./BaseIcon.vue";
import { ONE_TOKEN } from "../../../src/rules/app-emoji-token.ts";
import { appEmojiImage, appEmojiOf, loadAppEmojis } from "../composables/app-emojis.ts";
import { text } from "../text/index.ts";

const props = withDefaults(defineProps<{ char: string; size?: number }>(), { size: 20 });

const token = computed(() => ONE_TOKEN.test(props.char));
// 토큰을 그릴 때 목록이 없으면 불러온다(한 번). 서버 화면의 장르 이모지처럼 따로 부르지 않는 곳도 있다
watch(token, (now) => now && void loadAppEmojis(), { immediate: true });
const app = computed(() => (token.value ? appEmojiOf(props.char) : null));

/** 키캡이면 그 SVG 주소. Twemoji 는 키캡 파일 이름에서 VS16(FE0F)을 뗀다(31-20e3.svg) */
const keycap = computed(() => {
  const base = /^([0-9#*])️?⃣$/u.exec(props.char)?.[1];
  return base ? `${import.meta.env.BASE_URL}${__TWEMOJI_DIR__}/${base.charCodeAt(0).toString(16)}-20e3.svg` : null;
});
</script>
