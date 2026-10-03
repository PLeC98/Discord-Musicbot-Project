import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// 봇과 같이 쓰는 모듈(오류 · 거절 안내와 문제 코드 목록)은 저장소의 src 에서 상대 경로로 부른다.
// Node 에 기대는 자리(rules/pronunciations.ts)는 브라우저 판으로 바꿔 끼운다
const root = fileURLToPath(new URL("..", import.meta.url));
const pronunciationsBrowser = fileURLToPath(new URL("../src/rules/pronunciations.browser.ts", import.meta.url));

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [{ find: /^(?:.*\/)?pronunciations\.ts$/, replacement: pronunciationsBrowser }],
  },
  server: {
    port: 5173,
    // 공유 모듈 · 한자 표(data/) · 발음 사전 패키지가 저장소 뿌리에 있다
    fs: { allow: [root] },
    proxy: {
      "/api": {
        target: "http://localhost:33333",
        changeOrigin: true,
        credentials: true,
      },
      "/auth": {
        target: "http://localhost:33333",
        changeOrigin: true,
        credentials: true,
      },
    },
  },
});
