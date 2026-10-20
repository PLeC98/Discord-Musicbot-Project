// 재생 테스트: 음원 주소 하나를 실제로 열어 본다(캐시 DB 화면). 곡 재생의 스트림 경로(stream-url)는 거치지 않는다:
// 그 경로는 곡의 audioFoundBy 에 따라 링크 데이터를 고치거나 다시 찾고, 직접 링크는 아무것도 열지 않는다.
//   유튜브 · 사운드클라우드  각 출처의 getStream(yt-dlp. 자식 프로세스 레지스트리에는 곡 찾기로 든다). 유튜브는 받아 둔 영상 정보를 쓰지 않고 지금 묻는다
//   직접 링크               SafeUrl 의 GET 으로 열어 음원인지 판정하고 끊는다(HEAD 를 막는 서버도 연다. 리다이렉트마다 내부 주소를 막는다).
//                           웹 페이지 · DRM 등 음원이 아니면 unsupported-link. HLS 는 목록까지만 받는다
// 라이브(인터넷 라디오 · 라이브 HLS 포함)는 지정할 수 없어 실패(live)로 둔다(지정하면 틀 때 건너뛴다).

import type { Readable } from "stream";
import * as YouTube from "./youtube/index.ts";
import * as SoundCloud from "./soundcloud/index.ts";
import * as DirectLink from "./direct.ts";
import { inputKind } from "../rules/input-kind.ts";
import { errorKind } from "../rules/error-kind.ts";
import type { Code } from "../rules/problems.ts";

/** 결과. 실패면 문제 코드(라이브면 live) */
type Probed = { ok: true } | { ok: false; code: Code | "live" };

// 여는 쪽. 테스트가 가짜를 넘긴다. 여기서 읽는 필드만
type Openers = {
  youtube: { getStream(url: string, options: { fresh: true }): Promise<{ isLive?: boolean }> };
  soundcloud: { getStream(url: string): Promise<unknown> };
  direct: { open(url: string): Promise<{ kind: "file"; body: Readable; radio: boolean } | { kind: "hls"; hls: { live: boolean } }> };
};
const REAL: Openers = { youtube: YouTube, soundcloud: SoundCloud, direct: DirectLink };

const LIVE: Probed = { ok: false, code: "live" };

/** 음원 주소 하나를 열어 본다. 던지지 않는다 */
async function probeSource(audioUrl: string, open: Openers = REAL): Promise<Probed> {
  try {
    switch (inputKind(audioUrl)) {
      case "youtube":
        return (await open.youtube.getStream(audioUrl, { fresh: true })).isLive ? LIVE : { ok: true };
      case "soundcloud":
        await open.soundcloud.getStream(audioUrl);
        return { ok: true };
      case "direct": {
        const opened = await open.direct.open(audioUrl);
        if (opened.kind === "hls") return opened.hls.live ? LIVE : { ok: true };
        opened.body.destroy();
        return opened.radio ? LIVE : { ok: true };
      }
      default:
        return { ok: false, code: "unsupported-link" };
    }
  } catch (error) {
    return { ok: false, code: errorKind(error) };
  }
}

export { probeSource };
export type { Probed, Openers };
