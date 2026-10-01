// 재생 조작의 응답 화면(Components V2). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다.
// 머리 줄 · 본문 · 작은 글씨의 꼬리 줄(누가 했나 등). 곡에 썸네일이 있으면 머리 칸 옆에 붙인다

import { ContainerBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, resolveColor } from "discord.js";
import { colorOf } from "./colors.ts";
import { formatMs } from "./format.ts";
import * as controlText from "./text/controls.ts";
import * as errors from "./text/errors.ts";
import type { Loop } from "../player/trackState.ts";

type Track = { title: string; pageUrl: string; thumbnail?: string | null };
/** 조작한 사람. 멘션으로 보인다 */
type Actor = { toString(): string };
type Look = { title?: string; body?: string | null; footer?: Array<string | null>; thumbnail?: string | null; color?: "brand" | "closed" | "error" };

// 머리 줄 · 본문을 한 덩이로, 썸네일이 있으면 그 옆에. 썸네일 없는 Section 은 보낼 때 거절되어 글자만 둔다
function frame({ title, body, footer = [], thumbnail, color = "brand" }: Look) {
  const head = [title ? `### ${title}` : null, body].filter(Boolean).join("\n");
  const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf(color)));
  const text = new TextDisplayBuilder().setContent(head);
  if (thumbnail) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  else container.addTextDisplayComponents(text);
  const small = footer.filter((line): line is string => Boolean(line)).map((line) => `-# ${line}`);
  if (small.length) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(small.join("\n")));
  return container;
}

// 누가 했나. 칸 이름과 멘션
const who = (label: string, by: Actor) => `${label} ${by}`;

/** 새 응답(본인에게만) */
const reply = (container: ContainerBuilder) => ({ components: [container], flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const });
/** 처음부터 Components V2 로 보낸 응답을 고칠 때 */
const edit = (container: ContainerBuilder) => ({ components: [container], flags: [MessageFlags.IsComponentsV2] as const });

/** 일시정지 · 재개 */
function paused(isPaused: boolean, track: Track, by: Actor) {
  const t = controlText.paused(isPaused, track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track.thumbnail });
}

/** 건너뛰기. 한곡 반복이면 처음부터 다시 틀었다(restarted) */
function skipped(restarted: boolean, track: Track, by: Actor) {
  if (restarted) return frame({ body: controlText.skipRestarted(track) });
  const t = controlText.skipped(track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track.thumbnail });
}

/** 이전 곡 */
const previous = (restarted: boolean) => frame({ body: controlText.previous(restarted) });

/** 정지. cleared 는 비운 대기열 곡 수 */
function stopped(track: Track | null | undefined, cleared: number, by: Actor) {
  const t = controlText.stopped(track, cleared);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by), t.footer], color: "closed" });
}

/** 섞기 */
function shuffled(count: number, by: Actor) {
  const t = controlText.shuffled(count);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)] });
}

/** 반복 모드 */
function loopSet(mode: Loop, track: Track | null | undefined, by: Actor) {
  const t = controlText.loopSet(mode);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track?.thumbnail });
}

/** 하이라이트로 옮기는 동안 */
const highlighting = () => frame({ body: controlText.highlighting() });
/** 하이라이트로 옮겼다. ms 는 옮긴 위치 */
function highlighted(track: Track, ms: number) {
  const t = controlText.highlighted(track);
  return frame({ title: t.title, body: t.description, footer: [`${t.at} \`${formatMs(ms)}\``] });
}

/** 받아들인 뒤에 실패했다. notice 는 오류 문장 */
const failed = (notice: string) => frame({ body: errors.withErrorMark(notice), color: "error" });

export { reply, edit, failed, paused, skipped, previous, stopped, shuffled, loopSet, highlighting, highlighted };
