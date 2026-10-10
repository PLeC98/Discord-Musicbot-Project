// 꾸미기(운영자가 올린 파비콘)를 화면에 붙이는 도우미

/** 열린 탭의 파비콘을 새 버전으로 바꿔 끼운다. 브라우저는 열린 탭의 아이콘을 잘 다시 받지 않는다 */
export function refreshFavicon(version: number) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const url = new URL(link.href);
    url.searchParams.set("v", String(version));
    link.href = url.pathname + url.search;
  }
}
