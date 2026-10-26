// 재생 출력. PCM(s16le 48kHz 스테레오)을 20ms 프레임으로 모아 인코딩 세션(media/encode-pool)에 보내고, 돌아온 Opus 패킷을 내준다.
// @discordjs/voice 에는 StreamType.Opus 로 넘긴다. inlineVolume 을 같이 넘기면 voice 가 prism 의 디코더 · 볼륨 · 인코더를 다시 끼운다.
//
// 미리 만드는 패킷은 세션의 깊이(depth)까지다: 보낸 것 + 받아 둔 것 + 읽는 쪽 버퍼. 볼륨은 보낼 때의 배율이라 바꾼 뒤 그만큼 지나 들린다.
// 받은 PCM 조각은 프레임으로 다 잘라 보낼 때까지 쓰기 callback 을 미뤄 위쪽(스플라이서 · ffmpeg 파이프)에 쌓아 둔다.
// 패킷은 voice 가 read() 할 때 그 자리에서 받는다(drain). 기다리는 동안 이벤트로 온 패킷은 바로 push 한다(처음 · 일시정지).

import { Duplex, pipeline, type Readable } from "stream";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import { FRAME_BYTES } from "./audio-splicer.ts";
import type { EncodeSession, SessionHooks } from "./encode-pool.ts";
const log = logger.child({ category: "player" });

type OpenEncoder = (hooks: SessionHooks) => EncodeSession;
type Pending = { chunk: Buffer; offset: number; done: (err?: Error | null) => void };

class OpusOutput extends Duplex {
  readonly #session: EncodeSession;
  #gain: number;
  #frame = Buffer.alloc(FRAME_BYTES);
  #fill = 0;
  // 다 채웠지만 깊이가 차서 아직 못 보낸 프레임(많아야 하나)
  #frames: Buffer[] = [];
  #inflight = 0;
  #ready: Buffer[] = [];
  // _read 가 빈손으로 끝났다. Node 는 push 가 올 때까지 _read 를 다시 부르지 않으므로 다음 패킷은 바로 push 한다
  #waiting = false;
  #started = false;
  #pending: Pending | null = null;
  #finish: ((err?: Error | null) => void) | null = null;
  #pumping = false;
  /** 받는 PCM 소스(attachOpusOutput 이 정한다). 어느 분기로 열었는지 볼 때 */
  source: Readable | null = null;

  /**
   * @param o.gain  처음 배율(0 ~ 1). 만든 뒤 바로 데이터가 흐르므로 처음부터 받는다
   * @param o.openEncoder  인코딩 세션을 여는 함수(media/encode-pool)
   */
  constructor({ gain, openEncoder }: { gain: number; openEncoder: OpenEncoder }) {
    super({ readableObjectMode: true, readableHighWaterMark: 1 });
    this.#gain = clampGain(gain);
    // 패킷 · 오류는 이 출력의 read() 밖(다른 출력의 read() · 이벤트 · 풀의 타이머)에서도 온다
    this.#session = openEncoder({ onPacket: (packet) => this.#onPacket(packet), onError: (err) => this.destroy(err) });
    // play() 전에 난 오류는 voice 의 리스너가 아직 없다. 그 경우는 play() 가 "already ended" 로 던져 재생 실패로 간다
    this.on("error", (err) => log.debug(`재생 출력 오류: ${messageOf(err)}`));
  }

  /** 곡 중간 볼륨 변경. 다음에 보내는 프레임부터 */
  setVolume(gain: number) {
    this.#gain = clampGain(gain);
  }

  get gain() {
    return this.#gain;
  }

  /** 멈춤 로그 · 테스트용: 보낸 것, 받아 둔 것(읽는 쪽 버퍼 포함), 못 보낸 프레임, 깊이 */
  describe() {
    return { inflight: this.#inflight, ready: this.#ready.length + this.readableLength, frames: this.#frames.length, depth: this.#session.depth };
  }

  // 와 있는 패킷을 먼저 받고 읽는다. _read 가 한 번 빈손으로 끝나면 Node 가 _read 를 다시 부르지 않아 여기서 받아야 한다.
  // 읽은 뒤에 보낸다(읽는 쪽 버퍼가 줄어든 뒤라야 깊이를 바로 센다)
  override read(size?: number) {
    if (!this.destroyed && !this.#ready.length && this.#inflight) this.#session.drain();
    // drain 이 이 출력에 오류를 주면 그 자리에서 destroy 된다
    if (this.destroyed) return null;
    const packet = super.read(size);
    this.#pump();
    if (packet === null && size !== 0 && this.#started && this.#inflight && !this.readableEnded) this.#session.late();
    return packet;
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, done: (err?: Error | null) => void) {
    this.#pending = { chunk, offset: 0, done };
    this.#pump();
  }

  // 남은 프레임 · 보낸 것 · 받아 둔 것을 다 내준 뒤 end 를 낸다
  _final(done: (err?: Error | null) => void) {
    this.#finish = done;
    this.#pump();
  }

  _read() {
    const packet = this.#ready.shift();
    if (packet) this.#emit(packet);
    else this.#waiting = true;
  }

  _destroy(err: Error | null, done: (err?: Error | null) => void) {
    this.#session.free();
    this.#pending = null;
    this.#frames = [];
    this.#ready = [];
    done(err);
  }

  #onPacket(packet: Buffer) {
    this.#inflight--;
    if (this.destroyed) return;
    if (this.#waiting) this.#emit(packet);
    else this.#ready.push(packet);
    this.#pump();
  }

  #emit(packet: Buffer) {
    this.#waiting = false;
    this.#started = true;
    this.push(packet);
  }

  // 깊이가 허락하는 만큼 프레임을 잘라 보낸다. 조각을 다 자르면 그 callback 을 부른다(다음 조각이 바로 들어올 수 있다).
  // callback · 세션이 다시 이 함수에 들어오는 것을 막는다(바깥 루프가 이어 처리한다)
  #pump() {
    if (this.#pumping || this.destroyed) return;
    this.#pumping = true;
    try {
      for (;;) {
        this.#send();
        if (this.#frames.length || !this.#pending) break;
        this.#cut(this.#pending);
      }
      this.#end();
    } catch (error) {
      // voice 의 read() 안에서 던지면 Node 가 error 로 바꿔 주지 않는다
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#pumping = false;
    }
  }

  #send() {
    while (this.#frames.length && this.#inflight + this.#ready.length + this.readableLength < this.#session.depth) {
      const frame = this.#frames.shift() as Buffer;
      this.#inflight++;
      this.#session.send(frame, this.#gain);
    }
  }

  // 조각에서 프레임 하나를 채운다. 세션이 보낸 프레임을 들고 있다가 다시 보낼 수 있어 프레임마다 새 버퍼다
  #cut(p: Pending) {
    const n = Math.min(FRAME_BYTES - this.#fill, p.chunk.length - p.offset);
    p.chunk.copy(this.#frame, this.#fill, p.offset, p.offset + n);
    this.#fill += n;
    p.offset += n;
    if (this.#fill === FRAME_BYTES) {
      this.#frames.push(this.#frame);
      this.#frame = Buffer.alloc(FRAME_BYTES);
      this.#fill = 0;
    }
    if (p.offset === p.chunk.length) {
      this.#pending = null;
      p.done();
    }
  }

  // 끝에 남은 20ms 미만은 버린다. 뒤에 voice 의 묵음 다섯이 이어진다
  #end() {
    if (!this.#finish || this.#pending || this.#frames.length || this.#inflight || this.#ready.length) return;
    const done = this.#finish;
    this.#finish = null;
    this.push(null);
    done();
  }
}

const clampGain = (gain: number) => (Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1);

/** PCM 소스 뒤에 출력을 붙인다. pipeline 이라 voice 가 출력을 destroy 하면 소스(ffmpeg stdout)까지 destroy 되고, 소스 오류도 출력의 error 가 된다 */
function attachOpusOutput(pcm: Readable, o: { gain: number; openEncoder: OpenEncoder }): OpusOutput {
  const output = new OpusOutput(o);
  output.source = pcm;
  pipeline(pcm, output, () => {
    /* 오류는 출력의 error 로도 나오고 voice · 우리 리스너가 받는다 */
  });
  return output;
}

export { OpusOutput, attachOpusOutput };
export type { OpenEncoder };
