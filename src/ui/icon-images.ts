// 디스코드 앱 이모지 그림 굽기. 아이콘 표(ui/icons)의 한 항목 + 바탕색 → 128 × 128 PNG(도는 것은 GIF).
// 타일: 둥근 사각형(모서리 28%)에 바탕색의 톤 40, 기호는 톤 98(rules/icon-tones). 흰 기호: 타일 없이 흰색(색 버튼 위).
// 머티리얼 기호는 글꼴 칸(960) 기준으로 모두 같은 배율이라 디자이너가 칸 안에서 맞춘 크기 보정이 살아 있다. 방패(SponsorBlock)는 자체 여백이 없어 경계 상자로 맞춘다.
// 같은 입력이면 같은 바이트다(sharp · libvips 판이 같을 때). 맞추기(app/app-emojis)가 디스코드에 올라간 것과 바이트로 견준다

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PROJECT } from "../infra/project-paths.ts";
import { iconTones } from "../rules/icon-tones.ts";
import { colorOf } from "./colors.ts";
import type { IconSpec, Tint } from "./icons.ts";

const SIZE = 128;
const RADIUS = SIZE * 0.28;
/** 머티리얼 기호: 글꼴 칸이 이모지 칸에서 차지하는 비율(디스코드에서 견주어 정함) */
const SCALE = 0.88;
/** 방패: 보이는 모양의 긴 변이 이모지 칸에서 차지하는 비율 */
const SHIELD = 0.7;
/** 도는 것: 한 바퀴 24장 · 장마다 50ms(1.2초) */
const SPIN_FRAMES = 24;
const SPIN_DELAY_MS = 50;
const WHITE = "#FFFFFF";

const DIR = path.join(PROJECT.data, "discord-icons");

let glyphs: Record<string, string> | null = null;
/** 기호 이름 → SVG 경로(글꼴 칸 960, y 위로). scripts/build-discord-icons 가 만든 것 */
function glyphPath(name: string) {
  glyphs ??= (JSON.parse(fs.readFileSync(path.join(DIR, "glyphs.json"), "utf8")) as { glyphs: Record<string, string> }).glyphs;
  const d = glyphs[name];
  if (!d) throw new Error(`기호 윤곽이 없습니다: ${name} (node scripts/build-discord-icons.ts 로 다시 만드세요)`);
  return d;
}

let shield: { paths: string; width: number; height: number; viewBox: string } | null = null;
/** SponsorBlock 하이라이트 방패의 경로. 편집기 속성(inkscape: 등)은 네임스페이스 없이 넣으면 SVG 해석이 깨져 걷어 낸다 */
function shieldOf() {
  if (!shield) {
    const svg = fs.readFileSync(path.join(DIR, "skipIcon.svg"), "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 1 1";
    const [, , width, height] = viewBox.split(/\s+/).map(Number);
    const paths = [...svg.matchAll(/<path[\s\S]*?\/>/g)].map((m) => m[0].replace(/\s[a-z]+:[a-z-]+="[^"]*"/g, "")).join("");
    shield = { paths, width, height, viewBox };
  }
  return shield;
}

// 기호 하나를 이모지 칸 가운데에. rotate: 도는 것의 각도
function glyphSvg(spec: IconSpec, color: string, rotate: number) {
  if (spec.glyph === "sponsorblock") {
    const { paths, width, height, viewBox } = shieldOf();
    const s = (SIZE * SHIELD) / Math.max(width, height);
    const [w, h] = [width * s, height * s];
    return `<svg x="${(SIZE - w) / 2}" y="${(SIZE - h) / 2}" width="${w}" height="${h}" viewBox="${viewBox}">${paths.replace(/fill:#ffffff/gi, `fill:${color}`)}</svg>`;
  }
  const s = (SIZE * (spec.scale ?? SCALE)) / 960;
  return `<path transform="rotate(${rotate} ${SIZE / 2} ${SIZE / 2}) translate(${SIZE / 2} ${SIZE / 2}) scale(${s} ${-s}) translate(-480 -480)" d="${glyphPath(spec.glyph)}" fill="${color}"/>`;
}

function svgOf(spec: IconSpec, tint: Tint, rotate = 0) {
  const body =
    spec.shape === "white"
      ? glyphSvg(spec, WHITE, rotate)
      : (() => {
          const { tile, glyph } = iconTones(colorOf(tint));
          return `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${tile}"/>${glyphSvg(spec, glyph, rotate)}`;
        })();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${body}</svg>`;
}

/** 그 항목의 그림. 도는 것은 움직이는 GIF */
async function imageOf(spec: IconSpec, tint: Tint): Promise<{ data: Buffer; animated: boolean }> {
  if (spec.shape !== "spin")
    return {
      data: await sharp(Buffer.from(svgOf(spec, tint)))
        .png()
        .toBuffer(),
      animated: false,
    };
  const frames = await Promise.all(
    Array.from({ length: SPIN_FRAMES }, (_, i) =>
      sharp(Buffer.from(svgOf(spec, tint, (360 / SPIN_FRAMES) * i)))
        .png()
        .toBuffer(),
    ),
  );
  const data = await sharp(frames, { join: { animated: true } })
    .gif({ delay: Array<number>(SPIN_FRAMES).fill(SPIN_DELAY_MS), loop: 0 })
    .toBuffer();
  return { data, animated: true };
}

export { imageOf, SIZE };
export const _internals = { svgOf };
