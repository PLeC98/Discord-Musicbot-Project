import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
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
