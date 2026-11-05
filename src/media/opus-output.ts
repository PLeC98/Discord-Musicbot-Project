// 출력 스트림. PCM(s16le 48kHz 스테레오)을 20ms 프레임으로 모아 인코딩 세션(media/encode-pool)에 보내고, 돌아온 Opus 패킷을 내준다.
// @discordjs/voice 에는 StreamType.Opus 로 넘긴다. inlineVolume 을 같이 넘기면 voice 가 prism 의 디코더, 볼륨, 인코더를 다시 끼운다.
//
// 미리 만드는 패킷은 세션의 큐 깊이(depth)까지다: 보낸 것 + 받아 둔 것 + 읽는 쪽 버퍼. 볼륨 배율(gain)은 보낼 때 곱하므로 바꾼 뒤 그만큼 지나 들린다.
// 받은 PCM 청크는 프레임으로 다 잘라 보낼 때까지 쓰기 callback 을 미뤄 위쪽(스플라이서, ffmpeg 파이프)에 쌓아 둔다.
// 패킷은 voice 가 read() 할 때 그 자리에서 받는다(drain). 기다리는 동안 이벤트로 온 패킷은 바로 push 한다(처음, 일시정지).

import { Duplex, pipeline, type Readable } from "stream";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import { FRAME_BYTES } from "./audio-splicer.ts";
import type { EncodeSession, SessionHooks } from "./encode-pool.ts";
import { addVoicePacket } from "../infra/upload-meter.ts";
const log = logger.child({ category: "player" });

type OpenEncoder = (hooks: SessionHooks) => EncodeSession;
type Pending = { chunk: Buffer; offset: number; done: (err?: Error | null) => void };
type OutputState = { inflight: number; ready: number; frames: number; depth: number; worker: number | null; oldestMs: number | null };

class OpusOutput extends Duplex {
  readonly #session: EncodeSession;
  #gain: number;
  #frame = Buffer.alloc(FRAME_BYTES);
  #fill = 0;
  // 다 채웠지만 큐 깊이가 차서 아직 못 보낸 프레임(많아야 하나)
  #frames: Buffer[] = [];
  #inflight = 0;
  #ready: Buffer[] = [];
  // _read 가 빈손으로 끝났다. Node 는 push 가 올 때까지 _read 를 다시 부르지 않으므로 다음 패킷은 바로 push 한다
  #waiting = false;
  #started = false;
  #pending: Pending | null = null;
  #finish: ((err?: Error | null) => void) | null = null;
  #pumping = false;
  // destroy 될 때의 상태. voice 가 패킷 공급이 끊겨 멈추면 출력 스트림을 destroy 한 뒤에 로그를 남긴다
  #last: OutputState | null = null;
  /** 받는 PCM 소스(attachOpusOutput 이 정한다). 어느 분기로 열었는지 볼 때 */
  source: Readable | null = null;

  /**
   * @param o.gain  처음 볼륨 배율(0 ~ 1). 만든 뒤 바로 데이터가 흐르므로 처음부터 받는다
   * @param o.openEncoder  인코딩 세션을 여는 함수(media/encode-pool)
   */
  constructor({ gain, openEncoder }: { gain: number; openEncoder: OpenEncoder }) {
    super({ readableObjectMode: true, readableHighWaterMark: 1 });
    this.#gain = clampGain(gain);
    // 패킷, 오류는 이 출력 스트림의 read() 밖(다른 출력 스트림의 read(), 이벤트, 풀의 타이머)에서도 온다
    this.#session = openEncoder({ onPacket: (packet) => this.#onPacket(packet), onError: (err) => this.destroy(err) });
    // play() 전에 난 오류는 voice 의 리스너가 아직 없다. 그 경우는 play() 가 "already ended" 로 던져 재생 실패로 간다
    this.on("error", (err) => log.debug(`출력 스트림 오류: ${messageOf(err)}`));
  }

  /** 곡 중간 볼륨 변경. 다음에 보내는 프레임부터 */
  setVolume(gain: number) {
    this.#gain = clampGain(gain);
  }

  get gain() {
    return this.#gain;
  }

  /** 멈춤 로그, 테스트용: 보낸 것, 받아 둔 것(읽는 쪽 버퍼 포함), 못 보낸 프레임, 큐 깊이, 워커 번호, 가장 오래 기다리는 답의 나이. destroy 뒤에는 그때의 값 */
  describe(): OutputState {
    return this.#last ?? { inflight: this.#inflight, ready: this.#ready.length + this.readableLength, frames: this.#frames.length, depth: this.#session.depth, ...this.#session.describe() };
  }

  // 와 있는 패킷을 먼저 받고 읽는다. _read 가 한 번 빈손으로 끝나면 Node 가 _read 를 다시 부르지 않아 여기서 받아야 한다.
  // 읽은 뒤에 보낸다(읽는 쪽 버퍼가 줄어든 뒤라야 큐 깊이를 바로 센다)
  override read(size?: number) {
    // 처음에는 큐 깊이만큼 모일 때까지 기다리므로 받아 둔 것이 있어도 받는다
    if (!this.destroyed && (!this.#ready.length || !this.#started) && this.#inflight) this.#session.drain();
    // drain 이 이 출력 스트림에 오류를 주면 그 자리에서 destroy 된다
    if (this.destroyed) return null;
    const packet = super.read(size);
    // voice 가 읽어 간 패킷은 곧 보내는 패킷이다(봇 상태 탭의 업로드)
    if (packet) addVoicePacket(packet.length);
    this.#pump();
    // 빈손이면 voice 가 그 20ms 를 무음으로 채운다. 원인을 가른다: 보낸 것이 있으면 워커가 늦었고, 보낸 것도 없으면 입력 PCM 이 끊겼다(끝내는 중은 빼고)
    if (packet === null && size !== 0 && this.#started && !this.readableEnded) {
      if (this.#inflight) this.#session.late();
      else if (!this.writableEnded) this.#session.underrun();
    }
    return packet;
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, done: (err?: Error | null) => void) {
    this.#pending = { chunk, offset: 0, done };
    this.#pump();
  }

  // 남은 프레임, 보낸 것, 받아 둔 것을 다 내준 뒤 end 를 낸다
  _final(done: (err?: Error | null) => void) {
    this.#finish = done;
    this.#pump();
  }

  _read() {
    this.#waiting = true;
    this.#take();
  }

  _destroy(err: Error | null, done: (err?: Error | null) => void) {
    this.#last = this.describe();
    this.#session.free();
    this.#pending = null;
    this.#frames = [];
    this.#ready = [];
    done(err);
  }

  #onPacket(packet: Buffer) {
    this.#inflight--;
    if (this.destroyed) return;
    this.#ready.push(packet);
    if (this.#waiting) this.#take();
    this.#pump();
  }

  // 기다리는 읽기에 받아 둔 패킷을 내준다. 처음에는 큐 깊이만큼 모일 때까지(보낸 것이 다 돌아왔으면 그대로) 기다린다.
  // 몰려 시작할 때 워커에 줄이 생겨도 첫 패킷 다음 프레임이 비지 않게 한다
  #take() {
    if (!this.#ready.length) return;
    if (!this.#started && this.#ready.length < this.#session.depth && this.#inflight) return;
    this.#waiting = false;
    this.#started = true;
    this.push(this.#ready.shift());
  }

  // 큐 깊이가 허락하는 만큼 프레임을 잘라 보낸다. 청크를 다 자르면 그 callback 을 부른다(다음 청크가 바로 들어올 수 있다).
  // callback, 세션이 다시 이 함수에 들어오는 것을 막는다(바깥 루프가 이어 처리한다)
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

  // 청크에서 프레임 하나를 채운다. 세션이 보낸 프레임을 들고 있다가 다시 보낼 수 있어 프레임마다 새 버퍼다
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

  // 끝에 남은 20ms 미만은 버린다. 뒤에 voice 의 무음 프레임 5개가 이어진다
  #end() {
    if (!this.#finish || this.#pending || this.#frames.length || this.#inflight || this.#ready.length) return;
    const done = this.#finish;
    this.#finish = null;
    this.push(null);
    done();
  }
}

const clampGain = (gain: number) => (Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1);

/** PCM 소스 뒤에 출력 스트림을 붙인다. pipeline 이라 voice 가 출력 스트림을 destroy 하면 소스(ffmpeg stdout)까지 destroy 되고, 소스 오류도 출력 스트림의 error 가 된다 */
function attachOpusOutput(pcm: Readable, o: { gain: number; openEncoder: OpenEncoder }): OpusOutput {
  const output = new OpusOutput(o);
  output.source = pcm;
  pipeline(pcm, output, () => {
    /* 오류는 출력 스트림의 error 로도 나오고 voice, 우리 리스너가 받는다 */
  });
  return output;
}

export { OpusOutput, attachOpusOutput };
export type { OpenEncoder };
