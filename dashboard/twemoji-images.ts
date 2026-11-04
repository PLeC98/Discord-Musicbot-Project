// 키캡 이모지(1️⃣ #️⃣ *️⃣) 12개의 Twemoji 그림(디스코드가 올린 @discordapp/twemoji 의 SVG)을 화면과 같이 내준다.
// 다른 이모지는 Musicbot Twemoji 글꼴(scripts/build-twemoji-font.ts)이 그린다. 키캡만 글꼴에서 뺐다: 글꼴이 숫자, #, * 를 들고 있으면
// 본문의 숫자까지 이모지 글꼴 것으로 바뀐다. 이모지 하나를 칸에 그리는 자리(EmojiGlyph.vue)가 키캡만 이 그림을 쓴다.
// 봇은 assets/ 아래를 1년 캐시하므로(src/dashboard/index.ts) 버전을 경로에 넣는다. 화면은 __TWEMOJI_DIR__ 로 그 경로를 안다
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const packageFile = createRequire(import.meta.url).resolve("@discordapp/twemoji/package.json");
const { version } = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { version: string };
const SOURCE = path.join(path.dirname(packageFile), "dist", "svg");
const DIR = `assets/twemoji/${version}`;
/** 0 ~ 9, #, * 의 키캡. Twemoji 는 키캡 파일 이름에서 VS16(FE0F)을 뗀다 */
const KEYCAP = /^(?:3[0-9]|23|2a)-20e3\.svg$/;

export function twemojiImages(): Plugin {
  return {
    name: "twemoji-images",
    config: () => ({ define: { __TWEMOJI_DIR__: JSON.stringify(DIR) } }),
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${DIR}/`, (req, res) => {
        const name = (req.url ?? "").split("?")[0].slice(1);
        if (!KEYCAP.test(name) || !fs.existsSync(path.join(SOURCE, name))) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", "image/svg+xml");
        fs.createReadStream(path.join(SOURCE, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of fs.readdirSync(SOURCE)) {
        if (KEYCAP.test(name)) this.emitFile({ type: "asset", fileName: `${DIR}/${name}`, source: fs.readFileSync(path.join(SOURCE, name)) });
      }
    },
  };
}
