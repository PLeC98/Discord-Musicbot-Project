// 직접 링크를 재생 · 다운로드 입력으로 연다(sources/direct 의 open). 파일은 그 본문, HLS 는 조각 스트림(media/fragment-stream).
//   live     끝이 없다(인터넷 라디오 · 라이브 HLS). 캐시하지 않는다
//   bounded  끝이 있고 크기 · 길이를 안다(크기를 알린 파일 · VOD HLS). 재생과 나란히 다운로드해도 된다

import type { Readable } from "stream";
import * as DirectLink from "../sources/direct.ts";
import { codedError } from "../rules/error-kind.ts";
import { streamFragments } from "./fragment-stream.ts";

type DirectInput = Readable & {
  headers?: Record<string, unknown>;
  live: boolean;
  bounded: boolean;
  /** 곡 안의 어느 위치(ms)부터 흘리나(HLS VOD 는 위치가 든 조각부터) */
  startedAtMs?: number;
  describe?(): string;
};
/**
 * startMs: 곡 안의 시작 위치(HLS VOD 만 조각으로 맞춘다. 나머지는 ffmpeg 의 -ss)
 * liveOnly: 끊긴 라이브를 다시 연다. 라이브 HLS 의 목록이 끝났으면 틀지 않고 live-ended(다시보기를 처음부터 틀지 않는다)
 */
type InputOptions = { startMs?: number; liveOnly?: boolean; bodyIdleMs?: number };
type Open = (url: string, net?: undefined, opts?: { bodyIdleMs?: number }) => Promise<DirectLink.DirectOpen>;

async function openDirectInput(url: string, { startMs = 0, liveOnly = false, bodyIdleMs }: InputOptions = {}, open: Open = DirectLink.open): Promise<DirectInput> {
  const opened = await open(url, undefined, { bodyIdleMs });
  if (opened.kind === "file") return Object.assign(opened.body, { live: opened.radio, bounded: !opened.radio && opened.length !== null });
  const { hls } = opened;
  if (liveOnly && !hls.live) throw codedError("live-ended", `라이브 HLS 의 목록이 끝났습니다: ${url}`);
  return Object.assign(streamFragments(hls.fragments(startMs)), { live: hls.live, bounded: !hls.live });
}

export { openDirectInput };
export type { DirectInput, InputOptions as DirectInputOptions };
