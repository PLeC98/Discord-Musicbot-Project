// 봇의 앱 이모지 전부(아이콘, 대시보드에서 올린 것, 개발자 포털에서 올린 것). app/app-emojis 가 싣고,
// 보내는 쪽(음성 상태, 공지, 장르 메뉴)과 대시보드 경로가 토큰을 찾을 때 쓴다(ui/app-emoji-token). 아이콘만의 이름 → id 는 ui/icons 가 따로 갖는다
import { RETIRED_EMOJI_NAMES, iconEntries } from "./icons.ts";
import type { AppEmoji, EmojiBook } from "./app-emoji-token.ts";

let emojis: readonly AppEmoji[] = [];
const iconUnicode = new Map(iconEntries().map((entry) => [entry.name, entry.spec.unicode]));

/** 앱의 이모지 목록을 통째로 교체한다 */
function useAppEmojis(next: readonly AppEmoji[]) {
  emojis = next.map(({ id, name, animated }) => ({ id, name, animated }));
}

const appEmojis = (): readonly AppEmoji[] => emojis;

/** 지금 목록, 아이콘의 옛 이름과 유니코드로 찾는다 */
function emojiBook(): EmojiBook {
  return { emojis, retired: RETIRED_EMOJI_NAMES, iconUnicode: (name) => iconUnicode.get(name) };
}

export { useAppEmojis, appEmojis, emojiBook };
