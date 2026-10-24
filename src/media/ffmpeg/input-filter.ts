// ffmpeg 가 남이 준 바이트를 읽을 때 `-i` 앞에 붙이는 입력 필터.
// 재생 목록 · 이어 붙이기 목록처럼 다른 파일 · 주소를 읽는 형식(hls · concat · image2 등)을 막고(형식 필터링) 그 입력 말고는 열지 않는다(프로토콜 필터링).
// 형식은 디먹서 이름이다(확장자가 아니다: mov 가 mp4 · m4a, matroska 가 webm, aac 가 ADTS). 목록에 없는 디먹서로 판별되면 열기가 실패한다

/** 음원(직접 링크 · 유튜브 · 사운드클라우드가 주는 것). mpegts 는 HLS 의 TS 조각을 이어 붙인 것(다른 파일 · 주소를 읽지 않는다) */
const AUDIO_FORMATS = ["mov", "matroska", "mp3", "aac", "flac", "ogg", "wav", "w64", "aiff", "caf", "asf", "ape", "wv", "tta", "mpc", "mpc8", "ac3", "eac3", "dts", "dtshd", "amr", "au", "mpegts"];
/** 캐시 파일(봇이 만든 Ogg Opus, 백업으로 불러온 것도 같은 자리에 든다) */
const CACHE_FORMATS = ["ogg"];
/** 영상 컨테이너와 움직이는 그림(로그인 배경 원본) */
const VIDEO_FORMATS = ["mov", "matroska", "avi", "flv", "mpegts", "mpeg", "ogg", "asf", "gif", "webp_anim", "apng"];

/** from: 파일 입력이면 file, 표준 입력(`pipe:0`)이면 pipe */
const inputFilter = (formats: readonly string[], from: "file" | "pipe") => ["-protocol_whitelist", from, "-format_whitelist", formats.join(",")];

export { inputFilter, AUDIO_FORMATS, CACHE_FORMATS, VIDEO_FORMATS };
