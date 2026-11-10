import { escapeMarkdown } from "discord.js";
import type { Look } from "./text/ko/errors.ts";
import config from "../config/index.ts";

// 곡 제목, 파일 이름은 외부에서 오는데 그대로 메시지에 실린다. 멘션과 마스크드 링크를 막는다.

// 클라이언트 기본값. 멘션이 필요한 곳은 payload에서 users/roles를 명시해 덮어쓴다.
const ALLOWED_MENTIONS = { parse: [], repliedUser: false };

// 메시지 본문용. maskedLink 옵션이 `[클릭](url)`의 여는 대괄호를 막는다. 없으면 제목이 클릭되는 링크로 렌더링된다.
// 마스크드 링크 라벨 안에는 쓰지 말고 linkLabel을 쓸 것. 라벨 안에서는 백슬래시가 이스케이프로 해석되지 않고 화면에 그대로 노출된다.
const escapeMd = (text: unknown) => escapeMarkdown(String(text ?? ""), { maskedLink: true });

// 글자 모양 선택자(VS15). 디스코드가 라벨을 검사하기 전에 걸러 내는 폭 없는 공백과 달리 남아서, 뒤따르는 모양을 끊는다
const VS15 = "\uFE0E";
// 이모지 안에서 그대로 두는 이음 글자(ZWJ, 키캡, 태그 국기의 태그)와 빼는 글자(VS16, 피부색). 피부색은 글자 모양에서 회색 네모로 따로 보인다
const isJoiner = (cp: number) => cp === 0x200d || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f);
const isDropped = (cp: number) => cp === 0xfe0f || (cp >= 0x1f3fb && cp <= 0x1f3ff);
const textStyle = (emoji: string) =>
  [...emoji]
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return isDropped(cp) ? "" : isJoiner(cp) ? c : c + VS15;
    })
    .join("");

/**
 * 마스크드 링크 라벨 `[여기](url)`에 넣는 외부 문자열. 디스코드가 라벨을 닫거나 링크를 버리는 모양을 보이지 않는 글자로 끊는다.
 * `](`: 라벨을 닫아 다른 주소의 링크가 된다(`x](https://다른곳) [y`의 x). 사이에 폭 없는 공백.
 * `<…>` 모양(멘션, 커스텀 이모지, 명령), `@everyone`, `@here`, `:이름:`: 링크를 버린다. 첫 글자 뒤에 VS15.
 * emojiLinks: 라벨 안의 이모지를 받는 곳(웹훅 메시지, 임베드)이면 true. 아니면 이모지도 링크를 버려 글자 모양(흑백)으로 바꾼다
 */
function linkLabel(text: string, { emojiLinks = false } = {}) {
  const shaped = emojiLinks ? text : text.replace(/\p{RGI_Emoji}/gv, textStyle);
  return shaped
    .replaceAll("](", "]\u200b(")
    .replaceAll("<", `<${VS15}`)
    .replace(/@(?=everyone|here)/g, `@${VS15}`)
    .replace(/:(?=[\w+-]+:)/g, `:${VS15}`);
}

// 오류, 거절 안내(ui/text/ko/errors)의 값을 디스코드 형식으로: 채널은 멘션, 봇 개발자는 소스 저장소 링크(.env 의 SOURCE_REPO_URL, 없으면 원본)
const DISCORD_LOOK: Look = { channel: (id) => `<#${id}>`, developer: () => `[봇 개발자](${config.bot.sourceRepo})` };

export { ALLOWED_MENTIONS, escapeMd, linkLabel, DISCORD_LOOK };
