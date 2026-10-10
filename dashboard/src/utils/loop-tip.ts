// 반복 버튼의 툴팁: 지금 모드와 누르면 바뀔 모드(이름표는 디스코드 패널의 반복 버튼과 같다). 라이브가 있으면 못 누르는 까닭
import { nextLoopMode, type Loop } from "../../../src/rules/loop-cycle.ts";
import { modeOf } from "../../../src/dashboard/contract/player.ts";
import { loopLabel } from "../../../src/ui/text/ko/panel.ts";
import { noticeText } from "./problem.ts";
import { text } from "../text/index.ts";

export function loopTip(s: { loop?: Loop; hasLive?: boolean } | null | undefined): string {
  if (s?.hasLive) return noticeText("live-no-loop").title;
  const loop = s?.loop ?? false;
  return text.player.loopTip(loopLabel(modeOf(loop)), loopLabel(modeOf(nextLoopMode(loop))));
}
