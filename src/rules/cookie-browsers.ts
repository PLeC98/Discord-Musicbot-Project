// 쿠키를 가져올 수 있는 브라우저(yt-dlp --cookies-from-browser, yt-dlp 2026.08.19). 설정 검사(config) · 운영 조절값 화면(쿠키 출처 선택)이 같이 본다.
// 쿠키 출처 값은 file · 브라우저 이름 · 브라우저[+키링][:프로필][::컨테이너](yt-dlp 의 형식) 중 하나다.

/** 화면의 선택 순서(널리 쓰는 것부터) */
const COOKIE_BROWSERS = ["chrome", "edge", "firefox", "safari", "whale", "brave", "opera", "vivaldi", "chromium"] as const;

/** 화면에 보일 이름 */
const COOKIE_BROWSER_NAMES: Readonly<Record<(typeof COOKIE_BROWSERS)[number], string>> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  whale: "Whale",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  chromium: "Chromium",
};

/** 값의 브라우저 이름 부분(키링 · 프로필 앞) */
const cookieBrowserOf = (source: string) => source.split(/[+:]/)[0].toLowerCase();

export { COOKIE_BROWSERS, COOKIE_BROWSER_NAMES, cookieBrowserOf };
