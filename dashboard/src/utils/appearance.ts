// 운영자가 올린 파비콘을 화면에 붙이는 헬퍼

/** 열린 탭의 파비콘을 새 버전으로 교체한다. 브라우저는 열린 탭의 아이콘을 잘 다시 불러오지 않는다 */
export function refreshFavicon(version: number) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const url = new URL(link.href);
    url.searchParams.set("v", String(version));
    link.href = url.pathname + url.search;
  }
}
