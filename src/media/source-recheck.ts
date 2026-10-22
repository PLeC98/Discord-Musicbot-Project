// 캐시해 둔 음원의 원본이 지금 어떤가: 같은가 · 바뀌었는가 · 견줄 수 없는가 · 사라졌는가 · 모르는가. 캐시의 다시 확인이 부른다.
// 원본에 한 번 묻고, 다운로드할 때 적어 둔 버전(media/audio-version)과 견준다. 무엇을 할지(알리기 · 다시 받기)는 부르는 쪽이 정한다.
//
//   유튜브        영상 정보 한 번(yt-dlp). 적어 둔 lmt 가 지금 포맷 어디에도 없으면 바뀜. 오디오 포맷의 길이가 캐시와 다른지도 적는다(자르기면 다르고, 오디오만 바꾸면 같다)
//   사운드클라우드 재생 주소 한 번(yt-dlp). 음원 파일 id 가 다르면 바뀜. 미리듣기만 남았으면 사라짐(sc-preview-only)
//   직접 링크     첫 1바이트만 받는 요청(가드를 거친다). ETag > Last-Modified > 전체 크기로 견준다
// 사라짐은 다시 해도 같은 답만(재생 테스트 · 직접 지정한 음원과 같은 가름, sources/dead-source). 일시 오류 · 요청 제한 · 만료된 주소는 모름이다

import * as YouTube from "../sources/youtube/index.ts";
import * as SoundCloud from "../sources/soundcloud/api.ts";
import * as SafeUrl from "../infra/safe-url.ts";
import { OPEN_ACCEPT } from "../sources/direct-open.ts";
import { deadSourceCode } from "../sources/dead-source.ts";
import { inputKind } from "../rules/input-kind.ts";
import { messageOf } from "../rules/error-kind.ts";
import * as versionOf from "./audio-version.ts";

/** 다운로드할 때 적어 둔 것(audio_cache). version 은 audio_version, durationSec 는 캐시 파일의 길이 */
type Stored = { version: string | null; durationSec: number | null };

/**
 * same: 같은 원본(version 은 적어 둔 버전과 같은 값).
 * changed: 바뀜(version 은 원본의 지금 버전). durationChanged: 유튜브에서 오디오 길이가 캐시와 다른가(모르면 null).
 * uncompared: 원본은 답했지만 견줄 버전이 없다(적어 둔 버전이 없는 캐시 · 버전을 주지 않는 서버. 다시 물어도 같다, 까닭).
 * gone: 원본에서 틀 수 없다(문제 코드). unknown: 이번에는 모른다(일시 오류 등, 까닭)
 */
type Recheck = { kind: "same"; version: string } | { kind: "changed"; version: string; durationChanged: boolean | null } | { kind: "uncompared"; reason: string } | { kind: "gone"; code: string } | { kind: "unknown"; reason: string };

/** 원본에 묻는 길. 테스트가 가짜를 넘긴다 */
type Deps = {
  youtubeInfo(url: string): Promise<{ formats?: unknown[] | null }>;
  soundcloudStream(url: string): Promise<{ url: string }>;
  directHead(url: string): Promise<{ headers: Record<string, unknown> }>;
};

// 길이가 이만큼(초) 넘게 다르면 다른 길이로 본다. 같은 영상의 포맷끼리도 0.1초쯤 다르다
const DURATION_SLACK_SEC = 1.5;

// 첫 1바이트만: 머리(ETag · Last-Modified · Content-Range)만 쓰고 바로 끊는다. HEAD 를 막는 서버가 있어 GET 으로
async function directHead(url: string) {
  const body = await SafeUrl.getStream(url, undefined, { accept: { ...OPEN_ACCEPT, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS }, from: 0, to: 0 });
  body.destroy();
  return { headers: body.headers as Record<string, unknown> };
}

const DEPS: Deps = {
  youtubeInfo: (url) => YouTube.getInfo(url),
  soundcloudStream: (url) => SoundCloud.getStream(url),
  directHead,
};

/** 원본이 지금 어떤가. 음원 주소의 출처로 묻는 길을 고른다 */
async function recheck(audioUrl: string, stored: Stored, deps: Deps = DEPS): Promise<Recheck> {
  const kind = inputKind(audioUrl);
  try {
    if (kind === "youtube") return youtube(await deps.youtubeInfo(audioUrl), stored);
    if (kind === "soundcloud") return compared(versionOf.fromSoundCloudUrl((await deps.soundcloudStream(audioUrl)).url), stored, sameSoundCloud);
    if (kind === "direct") return direct((await deps.directHead(audioUrl)).headers, stored);
    return { kind: "unknown", reason: `다시 확인하지 않는 출처(${kind})` };
  } catch (error) {
    return failed(error, kind);
  }
}

function youtube(info: { formats?: unknown[] | null }, stored: Stored): Recheck {
  const lmts = versionOf.lmtsOf(info.formats);
  const mine = versionOf.lmtOf(stored.version);
  if (!lmts.size) return { kind: "uncompared", reason: "원본 포맷에 lmt 가 없다" };
  if (!mine) return { kind: "uncompared", reason: "적어 둔 버전이 없다" };
  if (lmts.has(mine)) return { kind: "same", version: `lmt:${mine}` };
  const duration = versionOf.audioDurationOf(info.formats);
  const durationChanged = duration && stored.durationSec ? Math.abs(duration - stored.durationSec) > DURATION_SLACK_SEC : null;
  // 바뀐 원본의 버전은 포맷 하나의 lmt(편집하면 모든 포맷이 함께 바뀐다). 다시 받으면 그 포맷의 값이 audio_version 이 되고, 다음 확인에서 같음이 된다
  return { kind: "changed", version: `lmt:${[...lmts][0]}`, durationChanged };
}

function direct(headers: Record<string, unknown>, stored: Stored): Recheck {
  // 지운 파일 자리에 웹 페이지를 주는 서버(재생 테스트 · 직접 지정한 음원과 같은 가름)
  if (/^\s*text\/html/i.test(String(headers["content-type"] ?? ""))) return { kind: "gone", code: "unsupported-link" };
  return compared(versionOf.fromHeaders(headers), stored, versionOf.sameDirect);
}

// 사운드클라우드 두 버전: 같은 꼴(음원 파일 id 끼리 · 수정 시각끼리)만 견준다. 재생 주소에서는 늘 파일 id 라 적어 둔 것이 수정 시각이면 견줄 수 없다
const sameSoundCloud = (a: string, b: string) => (a.split(":")[0] === b.split(":")[0] ? a === b : null);

// 원본의 지금 버전을 적어 둔 것과 견준다. 어느 쪽이든 없거나 견줄 수 없으면 견주지 못함
function compared(now: string | null, stored: Stored, same: (a: string, b: string) => boolean | null): Recheck {
  if (!now) return { kind: "uncompared", reason: "원본이 버전을 주지 않는다" };
  if (!stored.version) return { kind: "uncompared", reason: "적어 둔 버전이 없다" };
  const verdict = same(stored.version, now);
  if (verdict === null) return { kind: "uncompared", reason: "견줄 값이 없다" };
  return verdict ? { kind: "same", version: stored.version } : { kind: "changed", version: now, durationChanged: null };
}

function failed(error: unknown, kind: string): Recheck {
  const code = deadSourceCode(error);
  if (code && code !== "live") return { kind: "gone", code };
  // 직접 링크는 묻는 길이 가드된 요청이라 상태로 가른다(404 · 410 은 사라짐, 그 밖은 일시 오류 · 막힘 · 만료된 주소일 수 있다)
  const status = (error as { status?: unknown } | null)?.status;
  if (kind === "direct" && (status === 404 || status === 410)) return { kind: "gone", code: "direct-unavailable" };
  return { kind: "unknown", reason: messageOf(error) };
}

export { recheck };
export type { Recheck, Stored, Deps as RecheckDeps };
