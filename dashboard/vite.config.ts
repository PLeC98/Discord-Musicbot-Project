import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// 봇과 같이 쓰는 모듈(오류 · 거절 안내와 문제 코드 목록)은 저장소의 src 에서 상대 경로로 부른다
const root = fileURLToPath(new URL("..", import.meta.url));

// 빌드에 들어간 소스 목록과 빌드 시각을 남긴다. 봇이 켜질 때 그 뒤에 고쳐진 파일이 있으면 옛 빌드라고 알린다(src/dashboard/client-freshness.ts, 이름도 거기와 같다)
function buildInputs(): Plugin {
  return {
    name: "build-inputs",
    apply: "build",
    generateBundle() {
      const files = new Set<string>();
      for (const id of this.getModuleIds()) {
        if (id.startsWith("\0")) continue;
        const file = id.split("?")[0];
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes("node_modules/")) continue;
        files.add(rel);
      }
      this.emitFile({ type: "asset", fileName: ".build-inputs.json", source: JSON.stringify({ builtAt: Date.now(), files: [...files].sort() }) });
    },
  };
}

// 빌드가 끝나면 글자 파일(JS · CSS · HTML · SVG · JSON)마다 압축본(.br · .gz)을 옆에 만든다. 봇이 받는 쪽에 맞춰 골라 보낸다(src/dashboard/precompressed.ts).
// 1KB 보다 작거나 압축해도 10% 넘게 줄지 않으면 만들지 않는다. 글꼴 · 그림은 이미 압축된 꼴이라 뺀다
function precompress(): Plugin {
  let outDir = "";
  return {
    name: "precompress",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((one) => (one.isDirectory() ? walk(path.join(dir, one.name)) : [path.join(dir, one.name)]));
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json)$/.test(file) || path.basename(file).startsWith(".")) continue;
        const raw = fs.readFileSync(file);
        if (raw.length < 1024) continue;
        const packs = [
          [".br", zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })],
          [".gz", zlib.gzipSync(raw, { level: 9 })],
        ] as const;
        for (const [ext, packed] of packs) if (packed.length < raw.length * 0.9) fs.writeFileSync(file + ext, packed);
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), buildInputs(), precompress()],
  server: {
    port: 5173,
    // 공유 모듈과 조사 도우미의 표(data/)가 저장소 뿌리에 있다
    fs: { allow: [root] },
    // 봇이 답하는 경로: API · 로그인 · 파비콘과 매니페스트(꾸미기에서 올린 그림)
    proxy: Object.fromEntries(["/api", "/auth", "/favicon", "/manifest.webmanifest"].map((route) => [route, { target: "http://localhost:33333", changeOrigin: true }])),
  },
});
