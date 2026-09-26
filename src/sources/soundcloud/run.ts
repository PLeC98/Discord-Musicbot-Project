// 사운드클라우드를 yt-dlp 로 읽는다. 공통 옵션만 쓰고(유튜브 전용 없음), 묻는 포맷을 줄여 요청 수를 줄인다.
//
// SoundCloud 는 요청이 몰리면 IP 를 막는다(15초 남짓에 200요청 안팎 → 403, 약 5분). 곡 하나에 드는 API 요청은
// 묻는 포맷 수에 달렸다(정보 1 + 포맷마다 1, 기본값이면 5). 그래서 쓰임마다 필요한 포맷만 묻는다.

// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlpSpawn.ts";
import { baseOptions } from "../ytdlpOptions.ts";
import { codedError, codeOf } from "../../rules/errorKind.ts";
import type { RunYtDlp, YtDlpFlags } from "../ytdlpSpawn.ts";

/**
 * 묻는 포맷(yt-dlp 의 soundcloud:formats).
 *   play         재생 · 캐시 받기. AAC 160k 가 SoundCloud 가 권하는 것이다(mp3 · opus 는 공식 API 에서 없앤다고 발표했다). 요청 3
 *   progressive  HLS 를 못 여는 ffmpeg. 파일 하나로 받는 mp3. 요청 2
 *   lookup       곡 찾기. 미리듣기는 mp3 조각만 있어 aac 만 물으면 "포맷 없음"이 된다. mp3 까지 물어야 미리듣기(_preview)와 다른 실패를 가른다. AAC 가 없는 곡도 이것으로 튼다. 요청 4
 */
const FORMATS = { play: "hls_aac", progressive: "http_mp3", lookup: "hls_aac,http_mp3" } as const;
type Formats = keyof typeof FORMATS;

/** 무엇을 읽는가. 없는 것(404)의 이름이 갈린다 */
type What = "track" | "set";

// yt-dlp 오류에서 읽을 글
const textOf = (error: unknown) => {
  const e = error as { stderr?: unknown; message?: unknown } | null;
  return String(e?.stderr || e?.message || error || "");
};

/**
 * 사운드클라우드 실패의 이름. yt-dlp 를 실행하는 곳이 붙인 이름(지역 차단 · 네트워크 · 429 등) 위에 사운드클라우드만의 뜻을 얹는다.
 *   no-formats  물은 포맷이 없다(부르는 쪽이 가른다: 미리듣기 · AAC 없는 곡)
 *   404         없거나 비공개인 곡 · 세트
 *   403         사운드클라우드가 요청이 몰린 IP 를 막았다(client_id 가 낡은 경우는 yt-dlp 가 다시 받아 한 번 더 묻는다)
 */
function nameOf(error: unknown, what: What): string | null {
  const text = textOf(error);
  if (/No video formats found/i.test(text)) return "no-formats";
  if (/HTTP Error 404/.test(text)) return what === "set" ? "playlist-unavailable" : "track-unavailable";
  if (/HTTP Error 403/.test(text)) return "rate-limited";
  const code = codeOf(error);
  return typeof code === "string" ? code : null;
}

// 여러 곡 중 일부를 받지 못하면 yt-dlp 는 1 로 끝나지만 JSON 은 끝까지 낸다(못 받은 곡은 null). 그 JSON 이면 쓴다
function partialPlaylist(error: unknown): unknown {
  const stdout = (error as { stdout?: unknown } | null)?.stdout;
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  try {
    const out = JSON.parse(stdout) as { _type?: unknown; entries?: unknown };
    return out && out._type === "playlist" && Array.isArray(out.entries) ? out : null;
  } catch {
    return null;
  }
}

/** 사운드클라우드에 쓸 yt-dlp 옵션. 공통 옵션 위에 포맷 줄이기와 extra */
function flagsFor(formats: Formats, extra: YtDlpFlags = {}): YtDlpFlags {
  return baseOptions({ extractorArgs: `soundcloud:formats=${FORMATS[formats]}`, ...extra });
}

/**
 * yt-dlp 로 한 번 읽는다(JSON). 실패는 사운드클라우드의 이름을 단 오류로 던진다(원래 오류는 cause).
 * 여러 곡에서 일부만 못 받은 것은 실패가 아니다.
 */
async function read(url: string, formats: Formats, what: What, extra: YtDlpFlags = {}, exec: RunYtDlp = youtubedl): Promise<unknown> {
  try {
    return await exec(url, flagsFor(formats, { dumpSingleJson: true, ...extra }));
  } catch (error) {
    const partial = partialPlaylist(error);
    if (partial) return partial;
    const name = nameOf(error, what);
    throw name
      ? codedError(
          name,
          textOf(error)
            .split("\n")
            .find((line) => /^ERROR/.test(line)) || textOf(error),
          { cause: error },
        )
      : error;
  }
}

export { FORMATS, flagsFor, read, nameOf, partialPlaylist };
export type { Formats, What };
