// 설정에 적어 두는 앱 이모지 토큰(디스코드 형식 <:이름:id>, 움직이면 <a:이름:id>)을 찾고 보낼 글로 바꾼다.
// 봇(음성 상태, 공지, 장르 메뉴)과 대시보드(입력란, 미리보기, 장르 칸)가 같은 함수를 쓴다. 대시보드 빌드가 거쳐 가므로 아무것도 부르지 않는다.
// 찾는 순서: id(스노플레이크는 다시 쓰이지 않아 살아 있으면 늘 맞다) → 이름(다시 올려 id 가 바뀐 아이콘, 다른 봇에서 옮겨 온 장르 파일)
// → 아이콘의 옛 이름(새 이름, 또는 빠진 아이콘의 유니코드) → 지금 아이콘 이름이면 그 유니코드(동기화 전, 실패) → 없음

/** 앱 이모지 하나 */
type AppEmoji = { id: string; name: string; animated: boolean };
/** 찾을 때 쓰는 것. retired: 아이콘의 옛 이름(ui/icons 의 RETIRED_EMOJI_NAMES), iconUnicode: 지금 아이콘 이름의 유니코드. 대시보드는 없이 쓴다 */
type EmojiBook = {
  emojis: readonly AppEmoji[];
  retired?: Readonly<Record<string, { renamed: string } | { unicode: string }>>;
  iconUnicode?: (name: string) => string | undefined;
};
/** 찾은 것: 앱 이모지, 대신 쓸 유니코드, 또는 없음 */
type Found = { emoji: AppEmoji } | { unicode: string } | null;

/** 글 속의 토큰. 이름은 디스코드 규칙(2 ~ 32자 [A-Za-z0-9_]), id 는 스노플레이크 */
const TOKEN = /<(a?):(\w{2,32}):(\d{17,20})>/g;
const ONE_TOKEN = /^<a?:\w{2,32}:\d{17,20}>$/;

const tokenOf = (emoji: AppEmoji) => `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;

function find(book: EmojiBook, name: string, id: string): Found {
  const byId = book.emojis.find((one) => one.id === id);
  if (byId) return { emoji: byId };
  const byName = book.emojis.find((one) => one.name === name);
  if (byName) return { emoji: byName };
  const retired = book.retired?.[name];
  if (retired && "renamed" in retired) return find(book, retired.renamed, "");
  if (retired) return { unicode: retired.unicode };
  const unicode = book.iconUnicode?.(name);
  return unicode ? { unicode } : null;
}

/** 글 속 토큰의 자리와 찾은 것 */
function tokensIn(text: string, book: EmojiBook): Array<{ from: number; to: number; name: string; id: string; found: Found }> {
  return [...text.matchAll(TOKEN)].map((m) => ({ from: m.index, to: m.index + m[0].length, name: m[2], id: m[3], found: find(book, m[2], m[3]) }));
}

/** 디스코드로 보낼 글: 토큰을 지금 이모지의 토큰으로, 없으면 대신 쓸 유니코드나 빈 글로 */
function toDiscordText(text: string, book: EmojiBook): string {
  return text.replace(TOKEN, (_whole, _a: string, name: string, id: string) => {
    const found = find(book, name, id);
    if (!found) return "";
    return "emoji" in found ? tokenOf(found.emoji) : found.unicode;
  });
}

/** 컴포넌트(선택 메뉴 옵션 등)의 이모지: 값이 토큰이면 찾은 앱 이모지나 대신 쓸 유니코드, 아니면 그 유니코드 그대로. 빈 값, 찾지 못한 토큰은 null */
function componentEmojiOf(value: string, book: EmojiBook): AppEmoji | { name: string } | null {
  if (!value) return null;
  if (!ONE_TOKEN.test(value)) return { name: value };
  const [, , name, id] = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(value) ?? [];
  const found = find(book, name, id);
  if (!found) return null;
  return "emoji" in found ? found.emoji : { name: found.unicode };
}

export { ONE_TOKEN, tokenOf, find, tokensIn, toDiscordText, componentEmojiOf };
export type { AppEmoji, EmojiBook, Found };
