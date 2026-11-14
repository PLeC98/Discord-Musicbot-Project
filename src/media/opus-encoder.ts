// 재생 송출용 Opus 인코더. libopus-wasm 은 이 파일에서만 부른다.
//
// 설정은 libopus 기본값(AUDIO, complexity 9, VBR)에 비트레이트 128k 다.
// libopus-wasm 은 complexity 10, 64k 를 직접 걸므로 둘 다 넘긴다. 비트레이트 상한도 여기 하나다.
// WASM 힙의 인코더는 GC 가 치우지 않는다. 다 쓰면 free() 를 불러야 한다.

import { Application, createEncoder, loadLibopus } from "libopus-wasm";

/** 48kHz 스테레오 20ms(960 샘플) 실수 PCM(인터리브 1920개, ±1) 한 프레임을 raw Opus 패킷 하나로 인코딩한다 */
type OpusEncoder = {
  encode(frame: Float32Array): Buffer;
  free(): void;
};

const FRAME_SAMPLES = 960;
const COMPLEXITY = 9;
// 캐시(128k)에 맞춘다. 더 올릴 수 있지만 청취로 그 위는 구분되지 않았다
const SEND_BITRATE = 128_000;

/** WASM 모듈을 불러 둔다. 기동 시 한 번 불러 두면 그 뒤 인코더 생성은 다음 틱 안에 끝난다 */
async function loadOpus(): Promise<{ libopusVersion: string }> {
  const { version } = await loadLibopus();
  return { libopusVersion: version };
}

async function createOpusEncoder(): Promise<OpusEncoder> {
  const encoder = await createEncoder({ sampleRate: 48_000, channels: 2, frameSize: FRAME_SAMPLES, application: Application.Audio, bitrate: SEND_BITRATE, complexity: COMPLEXITY });
  return {
    // 돌려받는 패킷은 WASM 힙의 복사본이다. voice 의 DAVE 경로가 Buffer.equals 를 부르므로 Buffer 로 감싼다
    encode(frame) {
      const packet = encoder.encodeFloat(frame);
      return Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength);
    },
    free() {
      encoder.free();
    },
  };
}

export { loadOpus, createOpusEncoder };
export type { OpusEncoder };
