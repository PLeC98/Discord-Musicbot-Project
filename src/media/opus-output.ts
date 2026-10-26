// 재생 출력. PCM(s16le 48kHz 스테레오)을 20ms 프레임으로 모아 볼륨을 곱하고 Opus 패킷으로 인코딩한다.
// @discordjs/voice 에는 StreamType.Opus 로 넘긴다. inlineVolume 을 같이 넘기면 voice 가 prism 의 디코더 · 볼륨 · 인코더를 다시 끼운다.
//
// 읽힐 때만 인코딩한다. voice 가 20ms 마다 read() 하면 그때 한 프레임을 인코딩하고, 받은 PCM 조각은 다 쓸 때까지
// 쓰기 callback 을 미뤄 위쪽(스플라이서 · ffmpeg 파이프)에 쌓아 둔다. 그래서 볼륨 변경이 (HWM + 1) 패킷 안에 들리고,
// 인코딩이 voice 의 오디오 주기마다 고르게 나뉜다. 받은 조각을 한꺼번에 인코딩하면 조각 단위로 몰려 주기가 밀린다.

import { Duplex, pipeline, type Readable } from "stream";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import { FRAME_BYTES } from "./audio-splicer.ts";
import type { OpusEncoder } from "./opus-encoder.ts";
const log = logger.child({ category: "player" });

type CreateEncoder = () => Promise<OpusEncoder>;
type Pending = { chunk: Buffer; offset: number; done: (err?: Error | null) => void };

// 해제하지 않은 채 GC 된 출력의 인코더를 마지막으로 해제한다. 여기 닿았다면 리소스를 정리하지 않는 경로가 있다
const unreleased = new FinalizationRegistry<OpusEncoder>((encoder) => {
  encoder.free();
  log.warn("정리되지 않은 재생 출력의 Opus 인코더를 GC 가 해제했습니다. 리소스를 destroy 하지 않는 경로가 있습니다");
});

class OpusOutput extends Duplex {
  #encoder: OpusEncoder | null = null;
  #ready: Promise<void>;
  #gain: number;
  // 직접 할당해야 Int16Array 뷰의 정렬이 보장된다(Buffer 풀의 조각은 홀수 오프셋일 수 있다)
  #frame = Buffer.alloc(FRAME_BYTES);
  #samples = new Int16Array(this.#frame.buffer, this.#frame.byteOffset, FRAME_BYTES / 2);
  #fill = 0;
  #pending: Pending | null = null;
  // 다 쓴 조각의 callback 중 패킷을 내보내지 못해(push 가 false) 미뤄 둔 것. 다음 _read 때 부른다
  #release: ((err?: Error | null) => void) | null = null;
  #finish: ((err?: Error | null) => void) | null = null;
  #pumping = false;
  /** 받는 PCM 소스(attachOpusOutput 이 정한다). 어느 분기로 열었는지 볼 때 */
  source: Readable | null = null;

  /**
   * @param o.gain  처음 배율(0 ~ 1). 만든 뒤 바로 데이터가 흐르므로 처음부터 받는다
   * @param o.createEncoder  인코더를 만드는 함수(media/opus-encoder). 비동기라 첫 쓰기가 기다린다
   */
  constructor({ gain, createEncoder }: { gain: number; createEncoder: CreateEncoder }) {
    super({ readableObjectMode: true, readableHighWaterMark: 1 });
    this.#gain = clampGain(gain);
    this.#ready = createEncoder().then((encoder) => {
      if (this.destroyed) return encoder.free();
      this.#encoder = encoder;
      unreleased.register(this, encoder, this);
    });
    // 데이터가 오기 전에 destroy 되고 생성이 실패하면 처리기가 없어 unhandled rejection 이 된다. 오류는 _write 가 낸다
    this.#ready.catch(() => {
      /* _write · _final 이 받아 낸다 */
    });
    // play() 전에 난 오류는 voice 의 리스너가 아직 없다. 그 경우는 play() 가 "already ended" 로 던져 재생 실패로 간다
    this.on("error", (err) => log.debug(`재생 출력 오류: ${messageOf(err)}`));
  }

  /** 곡 중간 볼륨 변경. 다음에 인코딩하는 프레임부터 */
  setVolume(gain: number) {
    this.#gain = clampGain(gain);
  }

  get gain() {
    return this.#gain;
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, done: (err?: Error | null) => void) {
    if (this.#encoder) return this.#accept(chunk, done);
    this.#ready.then(
      () => (this.destroyed ? done() : this.#accept(chunk, done)),
      (err: Error) => done(err),
    );
  }

  // 쓰기가 한 번도 없이 끝나면(ffmpeg 가 바로 끝남) 인코더가 아직 없을 수 있다. 그래도 end 는 내야 voice 가 Idle 로 간다
  _final(done: (err?: Error | null) => void) {
    this.#ready.then(
      () => {
        this.#finish = done;
        this.#pump();
      },
      (err: Error) => done(err),
    );
  }

  _read() {
    this.#pump();
  }

  _destroy(err: Error | null, done: (err?: Error | null) => void) {
    const encoder = this.#encoder;
    this.#encoder = null;
    this.#pending = null;
    this.#release = null;
    if (encoder) {
      unreleased.unregister(this);
      encoder.free();
    }
    done(err);
  }

  #accept(chunk: Buffer, done: (err?: Error | null) => void) {
    this.#pending = { chunk, offset: 0, done };
    this.#pump();
  }

  // 읽는 쪽이 받는 동안 프레임을 채워 인코딩한다. push 가 false 면 멈추고 다음 _read 때 이어 간다.
  // 조각의 callback 은 그 조각으로 만든 패킷을 내보낼 수 있을 때만 부른다. 먼저 부르면 다음 조각이 바로 들어와
  // 조각이 프레임 크기와 같을 때(스플라이서) 읽는 쪽이 멈춰도 인코딩이 계속된다.
  // callback 이 다음 _write 를 바로 부를 수 있어 다시 들어오는 것을 막는다(바깥 루프가 이어 처리한다)
  #pump() {
    if (this.#pumping || !this.#encoder) return;
    this.#pumping = true;
    try {
      const release = this.#release;
      this.#release = null;
      release?.();
      while (this.#pending) if (!this.#step(this.#pending)) return;
      // 끝에 남은 20ms 미만은 버린다. 뒤에 voice 의 묵음 다섯이 이어진다
      if (this.#finish && !this.#pending) {
        const done = this.#finish;
        this.#finish = null;
        this.push(null);
        done();
      }
    } catch (error) {
      // voice 의 read() 안(_read)에서 던지면 Node 가 error 로 바꿔 주지 않는다
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#pumping = false;
    }
  }

  // 조각에서 프레임을 채우고, 차면 인코딩해 내보낸다. 읽는 쪽이 멈추라고 하면(push 가 false) false
  #step(p: Pending) {
    const n = Math.min(FRAME_BYTES - this.#fill, p.chunk.length - p.offset);
    p.chunk.copy(this.#frame, this.#fill, p.offset, p.offset + n);
    this.#fill += n;
    p.offset += n;
    const used = p.offset === p.chunk.length;
    if (used) this.#pending = null;
    if (this.#fill === FRAME_BYTES) {
      this.#fill = 0;
      if (!this.push(this.#encodeFrame())) {
        if (used) this.#release = p.done;
        return false;
      }
    }
    if (used) p.done();
    return true;
  }

  #encodeFrame() {
    const gain = this.#gain;
    if (gain !== 1) {
      // 배율이 1 이하라 범위를 넘지 않는다. Int16Array 에 넣을 때 소수는 0 쪽으로 잘린다
      const samples = this.#samples;
      for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
    if (!this.#encoder) throw new Error("인코더가 이미 해제되었습니다");
    return this.#encoder.encode(this.#frame);
  }
}

const clampGain = (gain: number) => (Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1);

/** PCM 소스 뒤에 출력을 붙인다. pipeline 이라 voice 가 출력을 destroy 하면 소스(ffmpeg stdout)까지 destroy 되고, 소스 오류도 출력의 error 가 된다 */
function attachOpusOutput(pcm: Readable, o: { gain: number; createEncoder: CreateEncoder }): OpusOutput {
  const output = new OpusOutput(o);
  output.source = pcm;
  pipeline(pcm, output, () => {
    /* 오류는 출력의 error 로도 나오고 voice · 우리 리스너가 받는다 */
  });
  return output;
}

export { OpusOutput, attachOpusOutput };
export type { CreateEncoder };
