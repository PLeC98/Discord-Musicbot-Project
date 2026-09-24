// 곡 하나를 한 번 트는 동안만 사는 것. play() 가 부를 때마다 새로 만들고(위치 이동 · 재시도 · 복구 재개도 새 재생이다),
// 곡이 바뀌거나 플레이어를 정리하면 버린다. 늦게 도착한 이벤트는 "이게 지금 재생의 것인가"를 객체 동일성으로 가린다.
//
// 재생을 넘어 이어지는 것은 여기 두지 않는다. 곡 자체(currentTrack), 캐시 퇴거 보호 열쇠(_protectedAudioKey),
// 다시 틀 위치(lastPlaybackPosition)는 플레이어에 있다.

import type { AudioResource } from "@discordjs/voice";
import type { QueuedTrack } from "./track.ts";
import type { Transport } from "../rules/transportOf.ts";
import type { Segments } from "../sources/sponsorBlock.ts";
import type { StreamInfo } from "../sources/streamUrl.ts";

/** 같은 곡 안에서 위치를 옮길 때 다시 쓸 스트림 주소(startPlayback 이 남긴다) */
type Resume = { trackKey: string | null; platform: string; fetchedAt: number; resumeSupported: boolean; baseUrl: string | null; info: Partial<StreamInfo> };

class CurrentPlayback {
  track: QueuedTrack;
  startOffsetMs: number;
  resource: AudioResource | null;
  cacheFile: string | null;
  transport: Transport | null;
  isLive: boolean | null;
  sponsor: Segments | null;
  live: boolean;
  liveExitCode: number | null;
  inputProgressAt: number | null;
  resume: Resume | null;

  constructor(track: QueuedTrack, { startOffsetMs = 0 }: { startOffsetMs?: number } = {}) {
    this.track = track;
    this.startOffsetMs = startOffsetMs; // 이 재생의 시작 위치(곡 안의 ms)
    this.resource = null; // 음성 라이브러리의 오디오 리소스
    this.cacheFile = null; // 받아 둔 파일로 틀면 그 경로
    this.transport = null; // transportOf 의 답 { via, live, cacheable }
    this.isLive = null; // 지금 라이브인가(yt-dlp 의 답). 모르면 null
    this.sponsor = null; // SponsorBlock 구간 · 하이라이트(서버 설정으로 거른 것)
    this.live = false; // 라이브를 주소 갈래로 트는가. 끝 처리가 재연결 여부를 이걸로 가른다
    this.liveExitCode = null; // 그 갈래 ffmpeg 의 종료 코드(끝났으면)
    this.inputProgressAt = null; // 입력이 마지막으로 들어온 때. 버퍼링 감시가 본다
    this.resume = null; // 위치 재개에 다시 쓸 스트림 정보(같은 곡에서만)
  }
}

export type { Resume };
export { CurrentPlayback };
