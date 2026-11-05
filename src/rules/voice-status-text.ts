// 음성 채널 상태 문구. 운영자가 정한 앞 글(재생 중, 일시정지 접두어, 대기 중 문구)의 앱 이모지 토큰만 보낼 글로 바꾸고(rules/app-emoji-token)
// 곡 제목을 붙여 디스코드 한도(500자)에 맞춘다. 곡 제목은 바꾸지 않는다: 제목의 <:x:1> 같은 글이 바뀌거나 빠지지 않게.
// 자를 때는 제목 끝부터, 앞 글이 한도를 넘으면 토큰 가운데에서 자르지 않는다
import { toDiscordText, tokensIn, type EmojiBook } from "./app-emoji-token.ts";

/** 디스코드 음성 채널 상태 글의 한도 */
const VOICE_STATUS_MAX = 500;

/** 끝이 서로게이트 쌍의 앞 반쪽이면 뗀다(이모지를 반으로 자르지 않게) */
const dropHalf = (text: string) => (/[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text);

function voiceStatusText(lead: string, title: string, book: EmojiBook): string {
  const head = toDiscordText(lead, book);
  // 앞뒤 공백은 뗀다(빠진 이모지 자리, 제목 없는 대기 중 문구의 끝)
  const full = `${head}${title}`.trim();
  if (full.length <= VOICE_STATUS_MAX) return full;
  if (head.length < VOICE_STATUS_MAX) return dropHalf(`${head}${title.slice(0, VOICE_STATUS_MAX - head.length)}`).trim();
  // 앞 글만으로 넘친다: 한도에 걸친 토큰은 통째로 뺀다
  const cut = tokensIn(head, book).find(({ from, to }) => from < VOICE_STATUS_MAX && to > VOICE_STATUS_MAX)?.from ?? VOICE_STATUS_MAX;
  return dropHalf(head.slice(0, cut)).trim();
}

export { voiceStatusText, VOICE_STATUS_MAX };
