// yt-dlp 릴리스 태그의 모양. stable 은 2026.08.19, nightly · master 는 뒤에 시각이 붙는다(2026.09.27.232849)
const YTDLP_TAG = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** yt-dlp 릴리스 태그인가 */
const isYtdlpTag = (tag: string) => YTDLP_TAG.test(tag);

export { isYtdlpTag };
