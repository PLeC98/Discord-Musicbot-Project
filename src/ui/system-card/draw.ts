// /system 의 이미지 둘을 그린다: 위는 카드 그리드(상태, CPU, heap 메모리, 캐시, 디스크, 업타임, 현황), 아래는 최근 기록 그래프 셋.
// 디스코드 컨테이너 안에서 가로를 다 채우는 비율과 크기다(위 1600×928, 아래 1600×400).
// @napi-rs/canvas 의 그리기는 동기라 이 모듈은 워커(card-render/render-worker)에서만 부른다. 값만 받고 판정은 부르는 쪽(rules/status-levels)이 한다

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { argbFromHex } from "@material/material-color-utilities";
import { DEFAULT_SEED, schemeColors } from "../../rules/palette.ts";
import type { Level } from "../../rules/status-levels.ts";
import { formatBytes, formatSpan } from "../format.ts";
import { DASHBOARD_COLORS } from "../palette.ts";
import * as T from "../text/ko/system-card.ts";
import { ensureFonts } from "../card-render/canvas-fonts.ts";
import { FACES, FAMILIES, type Face } from "../card-render/fonts.ts";
import { drawIcon } from "../card-render/icon-paths.ts";
import type { CardIcon, StatusIcon } from "../card-render/icons.ts";

/** 그래프 하나: 값(오래된 것부터), 세로축 최댓값 */
type Series = { values: number[]; max: number };

/** 그릴 값. 크기는 바이트, 시간은 초, 비율은 % */
type CardData = {
  /** 색 체계의 바탕색(#rrggbb, 임베드 색). null 이면 기본색 */
  seed: string | null;
  overall: { level: Level; count: number };
  recent: { warn: number; error: number };
  cpu: { bot: number; system: number; cores: number; model: string; level: Level };
  heap: { used: number; limit: number; rss: number; percent: number; level: Level };
  cache: { bytes: number; maxBytes: number };
  disk: { drive: string; usedBytes: number; totalBytes: number; level: Level };
  uptime: { bot: number; os: number };
  overview: { guilds: number; playing: number; users: number };
  /** 그래프. minutes 는 기록 구간(분). 기록이 2개 미만이면 그래프 자리에 "기록을 모으는 중" */
  history: {
    minutes: number;
    cpuBot: Series;
    cpuSystem: Series;
    loop: Series & { now: number; level: Level };
    encoding: Series & { now: number; level: Level };
  };
};

const TOP = { width: 1600, height: 214 * 4 + 24 * 3 } as const;
const BOTTOM = { width: 1600, height: 400 } as const;
/** 카드 모서리(PC 컨테이너에서 약 14px), 카드 간격(약 8px), 카드 내부 여백(약 16px), 위 이미지 한 줄 높이, 칸 너비(3등분) */
const RADIUS = 40;
const GAP = 24;
const PAD = 44;
const ROW = 214;
const COL = (TOP.width - GAP * 2) / 3;
const WIDE = COL * 2 + GAP;
const RIGHT = COL * 2 + GAP * 2;
const rowY = (i: number) => i * (ROW + GAP);

const pct = (value: number) => `${Math.round(value)}%`;
const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
/** 밀리초: 10 미만은 소수 한 자리, 1초부터는 초 */
const msText = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : ms >= 10 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`);
const countText = (n: number) => n.toLocaleString("ko-KR");

type Colors = Record<string, string>;
const levelInk = (c: Colors, level: Level) => (level === "ok" ? c.primary : level === "warn" ? DASHBOARD_COLORS.warnInk : c.error);

type Box = { x: number; y: number; w: number; h: number };
type TextStyle = { face: Face; size: number; color: string; align?: "start" | "end" };
type Fill = { from?: number; value: number; color: string; alpha: number };

/** 그리기 도구. 캔버스마다 만든다 */
function pen(g: SKRSContext2D, c: Colors) {
  const setFace = (face: Face, size: number) => {
    g.font = `${FACES[face].weight} ${size}px ${FAMILIES}`;
    g.fontVariationSettings = FACES[face].variations;
    // 숫자는 고정폭(대시보드와 같다). 값이 바뀌어도 오른쪽 맞춤 숫자의 폭이 흔들리지 않는다
    g.fontVariantNumeric = "tabular-nums";
  };
  const width = (s: string, face: Face, size: number) => {
    setFace(face, size);
    return g.measureText(s).width;
  };
  /** maxWidth 를 넘으면 뒤를 잘라 말줄임표를 붙인다 */
  const fit = (s: string, { face, size }: Pick<TextStyle, "face" | "size">, maxWidth: number) => {
    if (width(s, face, size) <= maxWidth) return s;
    const chars = [...s];
    while (chars.length && width(`${chars.join("").trimEnd()}…`, face, size) > maxWidth) chars.pop();
    return chars.length ? `${chars.join("").trimEnd()}…` : "";
  };
  /** x, y 는 기준선. end 면 x 가 오른쪽 끝. maxWidth 를 주면 넘는 만큼 말줄임 */
  const text = (s: string, x: number, y: number, style: TextStyle & { maxWidth?: number }) => {
    const shown = style.maxWidth === undefined ? s : fit(s, style, style.maxWidth);
    setFace(style.face, style.size);
    g.fillStyle = style.color;
    g.textAlign = style.align === "end" ? "right" : "left";
    g.fillText(shown, x, y);
  };
  /** at 은 왼쪽 위, size 는 한 변 */
  const icon = (name: CardIcon | StatusIcon, at: { x: number; y: number; size: number }, color: string, fill = false) => drawIcon(g, name, at, color, fill);
  const rect = (b: Box, r: number, color: string, alpha = 1) => {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
    g.globalAlpha = 1;
  };
  /** 바탕이 막대인 카드. fills 는 왼쪽부터 칠하는 구간(from 은 시작 비율) */
  const barCard = (b: Box, fills: Fill[]) => {
    rect(b, RADIUS, c.surface_container);
    g.save();
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, RADIUS);
    g.clip();
    for (const f of fills) {
      g.globalAlpha = f.alpha;
      g.fillStyle = f.color;
      g.fillRect(b.x + b.w * clamp01(f.from ?? 0), b.y, b.w * clamp01(f.value), b.h);
    }
    g.restore();
    g.globalAlpha = 1;
  };
  /** 카드 제목(아이콘과 이름). 차지한 너비를 반환한다 */
  const title = (x: number, y: number, name: { icon: CardIcon; text: string }, maxWidth: number) => {
    icon(name.icon, { x, y: y - 34, size: 40 }, c.on_surface_variant);
    text(name.text, x + 52, y, { face: "strong", size: 40, color: c.on_surface, maxWidth: maxWidth - 52 });
    return 52 + Math.min(maxWidth - 52, width(name.text, "strong", 40));
  };
  return { g, c, width, text, icon, rect, barCard, title };
}
type Pen = ReturnType<typeof pen>;

// 상태: 대시보드 요약과 같은 판정, 같은 배지 색. 제목과 경고 수가 한 줄에 안 들어가면 경고 수를 아래 줄로(문장 길이는 언어마다 다르다)
function statusCard(p: Pen, d: CardData) {
  const { c } = p;
  const { level, count } = d.overall;
  const fill = level === "ok" ? c.primary_container : level === "warn" ? DASHBOARD_COLORS.warnInk : c.error_container;
  const ink = level === "ok" ? c.on_primary_container : level === "warn" ? DASHBOARD_COLORS.warnInk : c.on_error_container;
  p.rect({ x: 0, y: rowY(0), w: WIDE, h: ROW }, RADIUS, fill, level === "warn" ? 0.15 : 1);
  p.icon(level === "ok" ? "check_circle" : level === "warn" ? "warning" : "cancel", { x: PAD, y: rowY(0) + 63, size: 88 }, ink, true);
  const head = level === "ok" ? T.allOk : T.needsAttention(count);
  const recent = T.recent(d.recent.warn, d.recent.error);
  const left = PAD + 112;
  const room = WIDE - PAD - left;
  if (p.width(head, "strong", 56) + 48 + p.width(recent, "regular", 34) <= room) {
    p.text(head, left, rowY(0) + 124, { face: "strong", size: 56, color: ink });
    p.text(recent, WIDE - PAD, rowY(0) + 122, { face: "regular", size: 34, color: ink, align: "end" });
  } else {
    p.text(head, left, rowY(0) + 104, { face: "strong", size: 56, color: ink, maxWidth: room });
    p.text(recent, left, rowY(0) + 158, { face: "regular", size: 34, color: ink, maxWidth: room });
  }
}

// CPU: 큰 숫자는 봇, 바탕은 시스템 전체(옅게) 위에 봇(진하게). 모델 이름은 제목 옆
function cpuCard(p: Pen, d: CardData) {
  const { c } = p;
  const ink = levelInk(c, d.cpu.level);
  const y = rowY(1);
  p.barCard({ x: 0, y, w: WIDE, h: ROW }, [
    { value: d.cpu.system / 100, color: c.primary, alpha: 0.16 },
    { value: d.cpu.bot / 100, color: ink, alpha: 0.42 },
  ]);
  const modelX = PAD + p.title(PAD, y + 72, { icon: "memory", text: T.cpu }, WIDE - PAD * 2) + 28;
  p.text(d.cpu.model, modelX, y + 72, { face: "regular", size: 34, color: c.on_surface_variant, maxWidth: WIDE - PAD - modelX });
  p.text(T.cpuSub(Math.round(d.cpu.system), d.cpu.cores), PAD, y + ROW - 44, { face: "regular", size: 34, color: c.on_surface_variant });
  p.text(pct(d.cpu.bot), WIDE - PAD, y + ROW - 40, { face: "strong", size: 88, color: ink, align: "end" });
}

// heap 메모리: 상한 대비(대시보드와 같다)
function heapCard(p: Pen, d: CardData) {
  const { c } = p;
  const ink = levelInk(c, d.heap.level);
  const y = rowY(2);
  p.barCard({ x: 0, y, w: WIDE, h: ROW }, [{ value: d.heap.percent / 100, color: ink, alpha: 0.42 }]);
  p.title(PAD, y + 72, { icon: "terminal", text: T.heap }, WIDE - PAD * 2);
  p.text(T.heapSub(formatBytes(d.heap.used), formatBytes(d.heap.limit), formatBytes(d.heap.rss)), PAD, y + ROW - 44, { face: "regular", size: 34, color: c.on_surface_variant, maxWidth: WIDE - PAD * 2 });
  p.text(pct(d.heap.percent), WIDE - PAD, y + ROW - 40, { face: "strong", size: 88, color: ink, align: "end" });
}

/** 저장공간 작은 카드: 제목 오른쪽에 비율, 아래에 상세 정보 */
function storeCard(p: Pen, x: number, card: { name: { icon: CardIcon; text: string }; detail: string; big: string; bigInk: string; fills: Fill[] }) {
  const { c } = p;
  const y = rowY(3);
  p.barCard({ x, y, w: COL, h: ROW }, card.fills);
  p.title(x + PAD, y + 72, card.name, COL - PAD * 2 - p.width(card.big, "strong", 44) - 16);
  p.text(card.big, x + COL - PAD, y + 72, { face: "strong", size: 44, color: card.bigInk, align: "end" });
  p.text(card.detail, x + PAD, y + ROW - 44, { face: "regular", size: 34, color: c.on_surface_variant, maxWidth: COL - PAD * 2 });
}

// 캐시, 디스크: 저장공간 막대의 고정 색. 디스크는 캐시와 나머지 사용량을 나눠 칠한다
function storageCards(p: Pen, d: CardData) {
  const { c } = p;
  const cacheShare = d.cache.maxBytes > 0 ? d.cache.bytes / d.cache.maxBytes : 0;
  storeCard(p, 0, {
    name: { icon: "library_music", text: T.cache },
    detail: T.usedOf(formatBytes(d.cache.bytes), formatBytes(d.cache.maxBytes)),
    big: pct(cacheShare * 100),
    bigInk: c.on_surface,
    fills: [{ value: cacheShare, color: DASHBOARD_COLORS.storeCache, alpha: 0.5 }],
  });
  const total = d.disk.totalBytes;
  const cacheOnDisk = total > 0 ? Math.min(d.cache.bytes, d.disk.usedBytes) / total : 0;
  const diskShare = total > 0 ? d.disk.usedBytes / total : 0;
  storeCard(p, COL + GAP, {
    name: { icon: "hard_drive", text: T.disk(d.disk.drive) },
    detail: T.diskFree(formatBytes(Math.max(0, total - d.disk.usedBytes))),
    big: pct(diskShare * 100),
    bigInk: d.disk.level === "ok" ? c.on_surface : levelInk(c, d.disk.level),
    fills: [
      { value: cacheOnDisk, color: DASHBOARD_COLORS.storeCache, alpha: 0.5 },
      { from: cacheOnDisk, value: diskShare - cacheOnDisk, color: DASHBOARD_COLORS.storeOther, alpha: 0.5 },
    ],
  });
}

function uptimeCard(p: Pen, d: CardData) {
  const { c } = p;
  const room = COL - PAD * 2;
  p.rect({ x: RIGHT, y: 0, w: COL, h: ROW * 2 + GAP }, RADIUS, c.surface_container);
  p.title(RIGHT + PAD, 72, { icon: "timer", text: T.uptime }, room);
  p.text(T.uptimeBot, RIGHT + PAD, 176, { face: "regular", size: 34, color: c.on_surface_variant });
  p.text(formatSpan(d.uptime.bot), RIGHT + PAD, 240, { face: "strong", size: 60, color: c.on_surface, maxWidth: room });
  p.text(T.uptimeOs, RIGHT + PAD, 326, { face: "regular", size: 34, color: c.on_surface_variant });
  p.text(formatSpan(d.uptime.os), RIGHT + PAD, 380, { face: "medium", size: 44, color: c.on_surface, maxWidth: room });
}

function overviewCard(p: Pen, d: CardData) {
  const { c } = p;
  const y = rowY(2);
  p.rect({ x: RIGHT, y, w: COL, h: ROW * 2 + GAP }, RADIUS, c.surface_container);
  p.title(RIGHT + PAD, y + 72, { icon: "graphic_eq", text: T.overview }, COL - PAD * 2);
  const rows: Array<[CardIcon, string, number]> = [
    ["public", T.guilds, d.overview.guilds],
    ["headphones", T.playing, d.overview.playing],
    ["person", T.users, d.overview.users],
  ];
  rows.forEach(([icon, label, value], i) => {
    const ry = y + 124 + i * 100;
    p.rect({ x: RIGHT + 24, y: ry, w: COL - 48, h: 84 }, 42, c.surface_container_high);
    p.icon(icon, { x: RIGHT + 48, y: ry + 22, size: 40 }, c.on_surface_variant);
    p.text(label, RIGHT + 104, ry + 54, { face: "regular", size: 34, color: c.on_surface_variant });
    p.text(countText(value), RIGHT + COL - 52, ry + 56, { face: "strong", size: 40, color: c.on_surface, align: "end" });
  });
}

function drawTop(d: CardData, c: Colors) {
  const canvas = createCanvas(TOP.width, TOP.height);
  const p = pen(canvas.getContext("2d"), c);
  statusCard(p, d);
  cpuCard(p, d);
  heapCard(p, d);
  storageCards(p, d);
  uptimeCard(p, d);
  overviewCard(p, d);
  return canvas;
}

/** 작은 흐름 그래프. fill 이면 아래를 옅게 칠한다 */
function spark(g: SKRSContext2D, b: Box, s: Series, line: { color: string; fill: boolean }) {
  const n = s.values.length;
  const max = s.max > 0 ? s.max : 1;
  const points = s.values.map((v, i) => [b.x + (i / (n - 1)) * b.w, b.y + b.h - clamp01(v / max) * b.h] as const);
  const trace = () => {
    g.beginPath();
    points.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  };
  if (line.fill) {
    trace();
    g.lineTo(b.x + b.w, b.y + b.h);
    g.lineTo(b.x, b.y + b.h);
    g.closePath();
    g.globalAlpha = 0.18;
    g.fillStyle = line.color;
    g.fill();
    g.globalAlpha = 1;
  }
  trace();
  g.strokeStyle = line.color;
  g.lineWidth = 4;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.stroke();
}

/** CPU 그래프의 범례(봇, 시스템) */
function legend(p: Pen, x: number, botInk: string) {
  const { g, c } = p;
  const dot = (cx: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, 106, 8, 0, Math.PI * 2);
    g.fill();
  };
  const label = { face: "regular", size: 32, color: c.on_surface_variant } as const;
  dot(x + 8, botInk);
  p.text(T.legendBot, x + 24, 118, label);
  const second = x + 24 + p.width(T.legendBot, "regular", 32) + 28;
  dot(second + 8, c.outline);
  p.text(T.legendSystem, second + 24, 118, label);
}

type GraphCard = { name: string; now: string; ink: string; lines: Array<{ s: Series; color: string; fill: boolean }>; legend: boolean };

function graphCard(p: Pen, x: number, card: GraphCard, h: CardData["history"]) {
  const { g, c } = p;
  const label = { face: "regular", size: 32, color: c.on_surface_variant } as const;
  p.rect({ x, y: 0, w: COL, h: BOTTOM.height }, RADIUS, c.surface_container);
  p.text(card.name, x + PAD, 70, { face: "strong", size: 36, color: c.on_surface, maxWidth: COL - PAD * 2 - p.width(card.now, "strong", 44) - 16 });
  p.text(card.now, x + COL - PAD, 72, { face: "strong", size: 44, color: card.ink, align: "end" });
  if (card.legend) legend(p, x + PAD, card.ink);
  else p.text(T.p99, x + PAD, 118, label);
  g.fillStyle = c.outline_variant;
  g.fillRect(x + PAD, 315, COL - PAD * 2, 2);
  if (h.cpuBot.values.length < 2) {
    p.text(T.collecting, x + PAD, 240, label);
    return;
  }
  for (const line of card.lines) spark(g, { x: x + PAD, y: 140, w: COL - PAD * 2, h: 176 }, line.s, line);
  p.text(T.minutesAgo(h.minutes), x + PAD, 368, label);
  p.text(T.now, x + COL - PAD, 368, { ...label, align: "end" });
}

function drawBottom(d: CardData, c: Colors) {
  const canvas = createCanvas(BOTTOM.width, BOTTOM.height);
  const p = pen(canvas.getContext("2d"), c);
  const h = d.history;
  const cpuInk = levelInk(c, d.cpu.level);
  const loopInk = levelInk(c, h.loop.level);
  const encodingInk = levelInk(c, h.encoding.level);
  const cards: GraphCard[] = [
    {
      name: T.cpu,
      now: pct(d.cpu.bot),
      ink: cpuInk,
      lines: [
        { s: h.cpuSystem, color: c.outline, fill: false },
        { s: h.cpuBot, color: cpuInk, fill: true },
      ],
      legend: true,
    },
    { name: T.loop, now: msText(h.loop.now), ink: loopInk, lines: [{ s: h.loop, color: loopInk, fill: true }], legend: false },
    { name: T.encoding, now: msText(h.encoding.now), ink: encodingInk, lines: [{ s: h.encoding, color: encodingInk, fill: true }], legend: false },
  ];
  cards.forEach((card, i) => graphCard(p, i * (COL + GAP), card, h));
  return canvas;
}

/** 이미지 둘(PNG). 색 체계는 어두운 테마(디스코드 컨테이너 안에서 대시보드 어두운 테마와 같게) */
async function drawSystemCards(d: CardData) {
  ensureFonts();
  const seed = d.seed && /^#[0-9a-f]{6}$/i.test(d.seed) ? argbFromHex(d.seed) : DEFAULT_SEED;
  const c = schemeColors(seed, true);
  const [top, bottom] = await Promise.all([drawTop(d, c).encode("png"), drawBottom(d, c).encode("png")]);
  return { top, bottom };
}

export { drawSystemCards, TOP, BOTTOM };
export type { CardData, Series };
