// 응답 템플릿. 헤더 줄 · 본문 · 작은 글씨의 푸터를 한 화면(Components V2)으로 그리고, 곡에 썸네일이 있으면 헤더 옆에 붙인다.
// 오류 · 경고 안내(Notice)는 무엇에 관한 것인지(topic)로 헤더 줄의 이모지를, 얼마나 심각한지(severity)로 색을 정한다

import { ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, resolveColor } from "discord.js";
import { colorOf, type Meaning } from "./colors.ts";
import type { Notice, Topic } from "./text/notice.ts";

// 사용자가 할 일이 같으면 한 이모지
const EMOJI = {
  failed: "❌", // 처리하다 실패했다(봇 안쪽 · 연결 · 플랫폼이 막음)
  permission: "🚫", // 권한이 없다
  voice: "🎧", // 음성 채널
  stale: "⌛", // 오래된 버튼 · 메뉴
  input: "✏️", // 입력이 틀렸다
  notFound: "🔍", // 찾지 못했다
  link: "🔗", // 링크를 쓸 수 없다
  blocked: "🔒", // 곡이 막혀 있다
  live: "🔴", // 라이브
  waiting: "⏳", // 기다리는 중이라 지금은 못 함
  muted: "🔇", // 봇이 음소거됨
  autoplay: "🎲", // 자동재생
  state: "⚠️", // 그 밖에 지금 상태라 못 함 · 일부만 됨
} as const satisfies Record<Topic, string>;

/** 화면의 필드. footer 는 작은 글씨 줄들(비면 건너뛴다), divider 면 그 위에 구분선 */
type Look = { title?: string; body?: string | null; footer?: Array<string | null>; divider?: boolean; thumbnail?: string | null; color?: Meaning };

// 헤더 줄 · 본문을 한 블록으로, 썸네일이 있으면 그 옆에. 썸네일 없는 Section 은 보낼 때 거절되어 텍스트만 둔다
function frame({ title, body, footer = [], divider = false, thumbnail, color = "brand" }: Look) {
  const head = [title ? `### ${title}` : null, body].filter(Boolean).join("\n");
  const container = new ContainerBuilder().setAccentColor(resolveColor(colorOf(color)));
  const text = new TextDisplayBuilder().setContent(head);
  if (thumbnail) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)));
  else container.addTextDisplayComponents(text);
  const small = footer.filter((line): line is string => Boolean(line)).map((line) => `-# ${line}`);
  if (small.length && divider) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (small.length) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(small.join("\n")));
  return container;
}

const headOf = (notice: Notice) => `${EMOJI[notice.topic]} ${notice.title}`;

/** 오류 · 경고 안내의 화면 */
const noticeFrame = (notice: Notice) => frame({ title: headOf(notice), body: notice.body, color: notice.severity });

/** 새 응답(본인에게만) */
const reply = (container: ContainerBuilder) => ({ components: [container], flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const });
/** 채널에 보내는 메시지, 또는 처음부터 Components V2 로 보낸 메시지 · 응답을 고칠 때 */
const post = (container: ContainerBuilder) => ({ components: [container], flags: [MessageFlags.IsComponentsV2] as const });
/** 오류 · 경고 안내를 새 응답으로(본인에게만) */
const noticeReply = (notice: Notice) => reply(noticeFrame(notice));

export { frame, noticeFrame, noticeReply, reply, post, EMOJI };
export type { Look };
