// Twemoji 그림(디스코드가 올린 @discordapp/twemoji 의 SVG)을 화면과 같이 내준다. CDN 에 닿지 못하는 브라우저에서도 그림이 나오게.
// 봇은 assets/ 아래를 1년 캐시하므로(src/dashboard/index.ts) 판을 경로에 넣는다. 화면은 __TWEMOJI_DIR__ 로 그 경로를 안다(TwemojiImage.vue)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const packageFile = createRequire(import.meta.url).resolve("@discordapp/twemoji/package.json");
const { version } = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { version: string };
const SOURCE = path.join(path.dirname(packageFile), "dist", "svg");
const DIR = `assets/twemoji/${version}`;

export function twemojiImages(): Plugin {
  return {
    name: "twemoji-images",
    config: () => ({ define: { __TWEMOJI_DIR__: JSON.stringify(DIR) } }),
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${DIR}/`, (req, res) => {
        const name = (req.url ?? "").split("?")[0].slice(1);
        if (!/^[0-9a-f-]+\.svg$/.test(name) || !fs.existsSync(path.join(SOURCE, name))) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", "image/svg+xml");
        fs.createReadStream(path.join(SOURCE, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of fs.readdirSync(SOURCE)) {
        if (name.endsWith(".svg")) this.emitFile({ type: "asset", fileName: `${DIR}/${name}`, source: fs.readFileSync(path.join(SOURCE, name)) });
      }
    },
  };
}
