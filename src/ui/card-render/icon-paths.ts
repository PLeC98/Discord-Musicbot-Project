// 그리기 워커가 쓰는 아이콘(Material Symbols Rounded 윤곽). 윤곽은 scripts/build-discord-icons.ts가 data/discord-icons/card-icons.json에 뽑는다.
// 처음 쓸 때 읽어 두고 워커가 살아 있는 동안 유지한다

import fs from "node:fs";
import path from "node:path";
import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import { PROJECT } from "../../infra/project-paths.ts";
import type { CardIcon, StatusIcon } from "./icons.ts";

type Outlines = { unitsPerEm: number; line: Record<CardIcon, string>; fill: Record<StatusIcon, string> };
let outlines: Outlines | null = null;
const paths = new Map<string, Path2D>();

function pathOf(name: CardIcon | StatusIcon, fill: boolean) {
  outlines ??= JSON.parse(fs.readFileSync(path.join(PROJECT.data, "discord-icons", "card-icons.json"), "utf8")) as Outlines;
  const key = `${name}:${fill}`;
  let found = paths.get(key);
  if (!found) paths.set(key, (found = new Path2D(fill ? outlines.fill[name as StatusIcon] : outlines.line[name as CardIcon])));
  return { path: found, em: outlines.unitsPerEm };
}

/** 아이콘 하나. at은 왼쪽 위, size는 한 변. fill이면 채운 모양(상태 아이콘) */
function drawIcon(g: SKRSContext2D, name: CardIcon | StatusIcon, at: { x: number; y: number; size: number }, color: string, fill = false) {
  const { path: shape, em } = pathOf(name, fill);
  const s = at.size / em;
  g.save();
  g.translate(at.x, at.y + at.size);
  g.scale(s, -s);
  g.fillStyle = color;
  g.fill(shape);
  g.restore();
}

export { drawIcon };
