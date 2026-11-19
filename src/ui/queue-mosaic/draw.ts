// /queue 의 썸네일 모자이크를 그린다: 16:9 칸 5개씩 최대 두 줄, 칸마다 왼쪽 위에 대기열 번호. 칸 바깥은 투명(WebP)이라 컨테이너 바탕이 비친다.
// 칸 이미지는 메인 스레드(queue-mosaic/thumbnails)가 칸 크기로 다시 인코딩한 JPEG 뿐이다. 없는 칸은 음표 아이콘.
// @napi-rs/canvas 의 그리기는 동기라 이 모듈은 워커(card-render/render-worker)에서만 부른다

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { argbFromHex } from "@material/material-color-utilities";
import { DEFAULT_SEED, schemeColors } from "../../rules/palette.ts";
import { ensureFonts } from "../card-render/canvas-fonts.ts";
import { FACES, FAMILIES } from "../card-render/fonts.ts";
import { drawIcon } from "../card-render/icon-paths.ts";
import { CELL, GAP, PER_ROW, RADIUS, sizeOf, type MosaicData } from "./layout.ts";

/** 번호 배지: 반지름(두 자리까지는 원, 세 자리부터는 옆으로 늘어난다), 칸 모서리에서 떨어진 거리, 글자 크기, 바탕 불투명도 */
const BADGE = { radius: 26, margin: 10, size: 30, alpha: 0.92 } as const;
/** 이미지가 없는 칸의 음표 크기 */
const NOTE_SIZE = 72;
/** WebP 품질. 사진이라 손실 압축이 PNG 보다 열 배쯤 작다 */
const QUALITY = 80;

function badge(g: SKRSContext2D, c: Record<string, string>, x: number, y: number, number: number) {
  const label = String(number);
  g.font = `${FACES.strong.weight} ${BADGE.size}px ${FAMILIES}`;
  g.fontVariationSettings = FACES.strong.variations;
  g.fontVariantNumeric = "tabular-nums";
  const width = Math.max(BADGE.radius * 2, g.measureText(label).width + BADGE.radius);
  const left = x + BADGE.margin;
  const top = y + BADGE.margin;
  g.globalAlpha = BADGE.alpha;
  g.fillStyle = c.surface_container_highest;
  g.beginPath();
  g.roundRect(left, top, width, BADGE.radius * 2, BADGE.radius);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = c.on_surface;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, left + width / 2, top + BADGE.radius + 2);
}

/** 모자이크 한 장(WebP). 칸은 앞에서부터 PER_ROW 개씩 줄을 채운다 */
async function drawQueueMosaic(d: MosaicData): Promise<Buffer> {
  ensureFonts();
  const c = schemeColors(d.seed && /^#[0-9a-f]{6}$/i.test(d.seed) ? argbFromHex(d.seed) : DEFAULT_SEED, true);
  const size = sizeOf(d.cells.length);
  const canvas = createCanvas(size.width, size.height);
  const g = canvas.getContext("2d");
  const images = await Promise.all(d.cells.map((cell) => (cell.jpeg ? loadImage(Buffer.from(cell.jpeg.buffer, cell.jpeg.byteOffset, cell.jpeg.byteLength)).catch(() => null) : null)));
  d.cells.forEach((cell, i) => {
    const x = (i % PER_ROW) * (CELL.width + GAP);
    const y = Math.floor(i / PER_ROW) * (CELL.height + GAP);
    g.save();
    g.beginPath();
    g.roundRect(x, y, CELL.width, CELL.height, RADIUS);
    g.clip();
    const image = images[i];
    if (image) g.drawImage(image, x, y, CELL.width, CELL.height);
    else {
      g.fillStyle = c.surface_container_high;
      g.fillRect(x, y, CELL.width, CELL.height);
      drawIcon(g, "music_note", { x: x + (CELL.width - NOTE_SIZE) / 2, y: y + (CELL.height - NOTE_SIZE) / 2, size: NOTE_SIZE }, c.on_surface_variant);
    }
    g.restore();
    badge(g, c, x, y, cell.number);
  });
  return canvas.encode("webp", QUALITY);
}

export { drawQueueMosaic };
