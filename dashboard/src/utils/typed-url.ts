// 곡 추가 입력란에 친 글이 주소인가(주소면 검색하지 않는다). 봇의 판정(inputKind)이 링크로 보는 것에 더해, 아직 치는 중이거나 스킴을 뺀 주소도 주소로 본다.
// youtube, www, https 처럼 주소 조각이 든 검색어는 검색으로 둔다. 애매하면 검색이다
import { inputKind } from "../../../src/rules/input-kind.ts";
import { isKnownSiteHost } from "../../../src/rules/links.ts";

// 스킴 없는 주소: www. 뒤에 글자, 또는 호스트.최상위/경로(will.i.am 같은 이름이 걸리지 않게 경로가 있어야 한다)
const WWW = /^www\.[^.]/i;
const HOST_PATH = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\//iu;

export function typedUrl(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  // 봇이 링크로 받는 것(http, https 주소, spotify: URI)
  if (inputKind(text) !== "search") return true;
  // 주소에는 공백이 없다
  if (/\s/.test(text)) return false;
  // 스킴을 다 쳤다(호스트는 아직)
  if (/^https?:\/\//i.test(text)) return true;
  // 알려진 사이트의 도메인(youtube.com, youtu.be, open.spotify.com …)
  if (isKnownSiteHost(`https://${text}`)) return true;
  return WWW.test(text) || HOST_PATH.test(text);
}
