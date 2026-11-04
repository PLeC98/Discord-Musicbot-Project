// 봇의 앱 이모지(/api/app-emojis): 목록과, 입력란이 앱 이모지를 진짜 글자로 다루게 하는 바꾸기.
// 저장 값은 토큰(<:이름:id>), 입력란에는 이모지마다 정해진 문자(보조 사용자 정의 영역)로 보인다. 그 문자는 style.css 의 Musicbot App Emoji 글꼴이
// 그 이모지 그림으로 그린다. 안드로이드가 글자가 아닌 인라인 요소를 선택하지 못해 편집기 대신 이렇게 한다(notes 조사 기록 8.2, 8.3).
// 바꾸는 곳은 입력란 경계뿐이다: 보일 때 토큰 → 문자, 입력할 때 문자 → 토큰. 찾지 못한 토큰(지운 이모지)은 토큰 글자 그대로 보인다

import { computed, ref } from "vue";
import axios from "axios";
import { tokenOf, tokensIn, type EmojiBook } from "../../../src/ui/app-emoji-token.ts";
import type { AppEmojiItem, AppEmojiList } from "../../../src/dashboard/contract/app-emojis.ts";

/** 앱 이모지 전부(아이콘 포함). 읽기 전에는 비어 있다 */
export const appEmojis = ref<AppEmojiItem[]>([]);

const FAMILY = "Musicbot App Emoji";
let loading: Promise<void> | null = null;
let fontVersion = "";

const book = computed<EmojiBook>(() => ({ emojis: appEmojis.value }));
const byChar = computed(() => new Map(appEmojis.value.map((one) => [one.char, one])));
const byId = computed(() => new Map(appEmojis.value.map((one) => [one.id, one])));

/** 목록을 읽는다(한 번). again 이면 다시(올리기, 지우기 뒤) */
export function loadAppEmojis(again = false): Promise<void> {
  if (loading && !again) return loading;
  loading = axios
    .get<AppEmojiList>("/api/app-emojis")
    .then(({ data }) => {
      appEmojis.value = data.emojis;
      swapFont(data.fontVersion);
    })
    .catch(() => {
      // 다음에 다시 읽는다. 그동안 입력란의 토큰은 글자 그대로 보인다
      loading = null;
    });
  return loading;
}

// 글꼴은 style.css 의 @font-face 가 고정 주소로 건다(브라우저가 ETag 로 다시 확인한다). 같은 탭에서 목록이 바뀌면(올린 직후) 새 판을 하나 더 건다.
// 나중에 더한 것이 앞선다. 형식은 @font-face 의 tech() 차례와 같게: sbix 를 그리면 sbix, font-tech() 를 모르는 브라우저도 sbix, 아니면 SVG
function swapFont(version: string) {
  const first = !fontVersion;
  fontVersion = version;
  if (first || typeof FontFace === "undefined") return;
  const knowsTech = CSS.supports("font-tech(color-COLRv0)") || CSS.supports("font-tech(color-SVG)");
  const format = !knowsTech || CSS.supports("font-tech(color-sbix)") ? "sbix" : "svg";
  const face = new FontFace(FAMILY, `url(/api/app-emojis/font.${format}?v=${version})`, { unicodeRange: "U+F0000-FFFFD", display: "block" });
  document.fonts.add(face);
}

/** 저장 값 → 입력란: 찾은 토큰은 그 이모지의 문자로, 찾지 못한 토큰은 그대로 */
export function toChars(text: string): string {
  let out = text;
  for (const { from, to, found } of tokensIn(text, book.value).reverse()) {
    const item = found && "emoji" in found ? byId.value.get(found.emoji.id) : undefined;
    if (item) out = out.slice(0, from) + item.char + out.slice(to);
  }
  return out;
}

/** 입력란 → 저장 값: 앱 이모지 문자를 그 토큰으로 */
export function fromChars(text: string): string {
  return [...text].map((char) => (byChar.value.has(char) ? tokenOf(byChar.value.get(char)!) : char)).join("");
}

/** 찾지 못한 토큰(지웠거나 다른 봇의 이모지)이 있는가 */
export function hasMissing(text: string): boolean {
  return tokensIn(text, book.value).some(({ found }) => !found);
}

/** 앱 이모지 문자가 들어 있는가(복사, 잘라내기를 토큰으로 바꿀 때) */
export const hasAppEmojiChar = (text: string) => [...text].some((char) => byChar.value.has(char));

/** 이미지 주소(움직이는 것은 GIF) */
export const appEmojiImage = (emoji: { id: string; animated: boolean }) => `/api/app-emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`;

/** 토큰 하나를 찾는다(장르 이모지 칸 등). 못 찾으면 null */
export function appEmojiOf(token: string): AppEmojiItem | null {
  const [hit] = tokensIn(token, book.value);
  return hit?.found && "emoji" in hit.found ? (byId.value.get(hit.found.emoji.id) ?? null) : null;
}
