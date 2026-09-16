import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // emoji-picker는 웹 컴포넌트다 — 알려주지 않으면 Vue가 자기 컴포넌트로 착각해 렌더가 깨진다.
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "emoji-picker" } } }), tailwindcss()],
  server: {
    port: 5173,
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
