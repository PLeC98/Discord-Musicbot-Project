// 곡 하나를 한 번 트는 동안만 사는 것. play() 가 부를 때마다 새로 만들고(위치 이동, 재시도, 복구 재개도 새 재생이다),
// 곡이 바뀌거나 플레이어를 정리하면 버린다. 늦게 도착한 이벤트는 "이게 지금 재생의 것인가"를 객체 동일성으로 구분한다.
//
// 재생을 넘어 이어지는 것은 여기 두지 않는다. 곡 자체(currentTrack)와 다시 틀 위치(heldPositionMs)는 플레이어에,
// 캐시 보호는 저장 계층(store/audio-cache)에 서버마다 있다.

import type { AudioResource } from "@discordjs/voice";
import type { QueuedTrack } from "./track.ts";
import type { Transport } from "../rules/transport-of.ts";
import type { Segments } from "../sources/sponsor-block.ts";
import type { StreamInfo } from "../sources/stream-url.ts";
import type { InputHealth } from "../media/input-health.ts";
import type { OpusOutput } from "../media/opus-output.ts";
import type { GainTap } from "../media/gain-tap.ts";

class CurrentPlayback {
  track: QueuedTrack;
  startOffsetMs: number;
  resource: AudioResource | null;
  output: OpusOutput | null;
  tap: GainTap | null;
  cacheFile: string | null;
  transport: Transport | null;
  isLive: boolean | null;
  sponsor: Segments | null;
  live: boolean;
  input: InputHealth | null;
  inputProgressAt: number | null;
  stream: StreamInfo | null;
  audioKey: string | null;
  lengthMs: number | null;
  streamError: string | null;

  constructor(track: QueuedTrack, { startOffsetMs = 0 }: { startOffsetMs?: number } = {}) {
    this.track = track;
    this.startOffsetMs = startOffsetMs; // 이 재생의 시작 위치(곡 안의 ms)
    this.resource = null; // 음성 라이브러리의 오디오 리소스
    this.output = null; // 리소스 아래의 출력 스트림(볼륨, 인코딩). 곡 중간 볼륨 변경이 여기로 간다
    this.tap = null; // 출력 스트림이 볼륨 정규화의 게인을 묻는 탭(player/gain-control)
    this.cacheFile = null; // 캐시 파일로 틀면 그 경로
    this.transport = null; // transportOf 의 답 { via, live, cacheable }
    this.isLive = null; // 지금 라이브인가(yt-dlp 의 답). 모르면 null
    this.sponsor = null; // SponsorBlock 구간, 하이라이트(서버 설정으로 필터링한 것)
    this.live = false; // 라이브를 주소 분기로 트는가. 끝 처리가 재연결 여부를 이걸로 구분한다
    this.input = null; // 지금 소리를 내는 소스의 온전함. 캐시로 갈아타면 그쪽 것으로 바뀐다
    this.inputProgressAt = null; // 입력이 마지막으로 들어온 때. 버퍼링 감시가 본다
    this.stream = null; // 이 재생이 받은 스트림 서술자. 같은 곡을 다시 열 때 다시 쓴다(start-playback 의 commitPlaying 이 남긴다)
    this.audioKey = null; // 이 재생이 트는 음원의 캐시 키. 곡의 음원 주소는 재생 중에도 바뀌므로 연 때의 것을 든다(재생 횟수, 길이가 본다)
    this.lengthMs = null; // 트는 음원의 길이(곡 끝 판정, 넘침 안전망, 곡 끝 구간이 본다). 표시 길이(track.duration)와 따로다. 모르면 null
    this.streamError = null; // 종료 원인이 재생 스트림 오류일 때의 오류 메시지. 복구 줄이 원인으로 싣는다
  }
}

export { CurrentPlayback };
