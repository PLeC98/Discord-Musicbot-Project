import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// 봇과 같이 쓰는 모듈(오류 · 거절 안내와 문제 코드 목록)은 저장소의 src 에서 상대 경로로 부른다
const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // 공유 모듈과 조사 도우미의 표(data/)가 저장소 뿌리에 있다
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
