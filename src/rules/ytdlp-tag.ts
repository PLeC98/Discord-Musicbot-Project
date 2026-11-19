// yt-dlp 릴리스 태그의 모양과 채널. stable은 2026.08.19, nightly, master는 뒤에 시각이 붙는다(2026.09.27.232849)
const YTDLP_TAG = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

const isYtdlpTag = (tag: string) => YTDLP_TAG.test(tag);

/** yt-dlp를 받는 채널(설정과 update:ytdlp --channel이 함께 쓴다) */
const YTDLP_CHANNELS = ["stable", "nightly", "master"] as const;
type YtdlpChannelName = (typeof YTDLP_CHANNELS)[number];
const isYtdlpChannel = (value: string): value is YtdlpChannelName => (YTDLP_CHANNELS as readonly string[]).includes(value);

export { isYtdlpTag, YTDLP_CHANNELS, isYtdlpChannel };
export type { YtdlpChannelName };
