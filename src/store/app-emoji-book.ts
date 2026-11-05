// 봇의 앱 이모지 전부(아이콘, 대시보드에서 올린 것, 개발자 포털에서 올린 것)를 메모리에 둔다. app/app-emojis 가 동기화하며 싣는다.
// 보내는 쪽(음성 상태, 공지, 장르 메뉴)과 대시보드 경로가 설정에 적힌 토큰을 찾을 때 쓴다(rules/app-emoji-token).
// 아이콘의 옛 이름과 유니코드는 ui/icons 에 있어 app 이 넣는다(이 층은 ui 를 부를 수 없다). 아이콘만의 이름 → id 는 ui/icons 가 따로 갖는다
import type { AppEmoji, EmojiBook } from "../rules/app-emoji-token.ts";

let emojis: readonly AppEmoji[] = [];
let fallbacks: Pick<EmojiBook, "retired" | "iconUnicode"> = {};

/** 앱의 이모지 목록을 통째로 교체한다 */
function useAppEmojis(next: readonly AppEmoji[]) {
  emojis = next.map(({ id, name, animated }) => ({ id, name, animated }));
}

/** 아이콘의 옛 이름과 유니코드(찾지 못한 아이콘 토큰을 대신할 것). app 이 한 번 넣는다 */
function useIconFallbacks(next: Pick<EmojiBook, "retired" | "iconUnicode">) {
  fallbacks = next;
}

const appEmojis = (): readonly AppEmoji[] => emojis;

/** 지금 목록과 아이콘의 옛 이름, 유니코드로 찾는다 */
const emojiBook = (): EmojiBook => ({ emojis, ...fallbacks });

export { useAppEmojis, useIconFallbacks, appEmojis, emojiBook };
