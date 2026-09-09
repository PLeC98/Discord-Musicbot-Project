"use strict";

// 재생을 끊지 않고 오디오 소스를 갈아끼우는 스트림.
//
// 왜: 스트림이 죽으면 지금은 AudioPlayer가 Idle로 가고 play()를 다시 타 새 리소스를 만든다.
// 그 사이가 공백으로 들린다. 대신 ffmpeg와 createAudioResource '사이'에 이걸 두면
// AudioPlayer는 소스가 바뀐 줄도 모르고, playbackDuration도 끊기지 않는다.
//
// 서두를 필요가 없다는 게 핵심이다. 청크 수신(src/chunkedStream.js)은 ffmpeg에 청크 하나를
// 통째로 밀어넣으므로 연결이 죽어도 ffmpeg에 수십 초가 남는다. 그 활주로 동안 캐시 디코더를
// 띄우고(실측 43ms) 넉넉히 앞선 지점을 전환 지점으로 잡으면 공백이 0이 된다.
//
// 이음매는 등출력(equal-power) 크로스페이드로 덮는다. 선형으로 섞으면 교차점에서 -6dB
// 볼륨 딥이 생기지만 cos/sin은 -3dB로 평탄하다.
//
// 입출력 모두 s16le 48kHz 스테레오 PCM (MusicPlayer.buildFfmpegArgs의 출력 형식).

const { Readable } = require("stream");

const BYTES_PER_MS = 192; // s16le 48kHz 스테레오
const FRAME_BYTES = 20 * BYTES_PER_MS; // 20ms — @discordjs/voice의 프레임 주기

// 소스가 끝났는지. 'end'는 버퍼를 다 비워야 오므로, 꼬리가 남은 동안에도 참이 되는 신호가 필요하다.
const isEnded = (s) => s.readableEnded || s._readableState?.ended === true;

class AudioSplicer extends Readable {
  /**
   * @param {Readable} source  최초 소스 (ffmpeg stdout)
   * @param {number}   fadeMs  크로스페이드 길이
   */
  constructor(source, { fadeMs = 40 } = {}) {
    super({ highWaterMark: 64 * 1024 });
    this.a = source; // 현재 소스
    this.b = null; // 갈아탈 소스
    this.fadeBytes = Math.max(FRAME_BYTES, Math.round(fadeMs * BYTES_PER_MS));
    this.switchAtBytes = null;
    this.emitted = 0;
    this.faded = 0;
    this.switched = false;
    this.pumping = false;
    this.waiting = null;
    this._slips = 0; // 전환 지점을 뒤로 민 횟수(관측용)
    this.bDebt = 0; // 민 만큼 새 소스에서 버려야 할 바이트

    source.pause();
    source.on("error", (err) => this.destroy(err));
  }

  /** 지금까지 내보낸 오디오 길이(ms). 전환 지점을 잡는 기준. */
  get emittedMs() {
    return Math.floor(this.emitted / BYTES_PER_MS);
  }

  /** 전환 지점을 뒤로 민 횟수 — 새 소스가 늦어 재조정한 정도 */
  get slips() {
    return this._slips;
  }

  /** 전환이 예약됐거나 이미 이뤄졌는가 */
  get switchPending() {
    return this.b !== null;
  }

  /**
   * atMs 지점에서 next로 갈아탄다. next는 그 지점의 오디오를 내놓도록 이미 맞춰져 있어야 한다
   * (캐시 파일을 그 위치로 seek해 띄운 ffmpeg 등). 이미 지난 지점이면 즉시 전환한다.
   * @returns {boolean} 예약 성공 여부
   */
  planSwitch(next, atMs) {
    if (this.b || this.destroyed) return false;
    this.b = next;
    this.switchAtBytes = Math.max(this.emitted, Math.round(atMs * BYTES_PER_MS));
    next.pause();
    next.on("error", (err) => this.destroy(err));
    this._kick();
    return true;
  }

  // 프레임 하나를 꺼낸다. 꼬리(프레임 미만)는 소스가 끝났을 때만 꺼내야
  // 중간에 조각난 읽기가 생기지 않는다. null이면 지금은 줄 게 없다는 뜻.
  _take(s) {
    return s.read(FRAME_BYTES) || (isEnded(s) ? s.read() : null);
  }

  _read() {
    this._kick();
  }

  _kick() {
    if (this.pumping || this.destroyed) return;
    this.pumping = true;
    try {
      this._pump();
    } finally {
      this.pumping = false;
    }
  }

  _pump() {
    for (;;) {
      if (this.destroyed) return;

      // ── 전환 완료: 새 소스만 읽는다 (this.a === this.b) ──
      if (this.switched) {
        // 페이드를 거치지 않고 곧장 전환된 경로에서도 빚은 남아 있다. 갚기 전에 읽으면
        // 민 길이만큼 되풀이해 들린다.
        this._payDebt();
        if (this.bDebt > 0 && !isEnded(this.a)) return this._await(this.a, true);
        const c = this._take(this.a);
        if (!c) return this._await(this.a, true);
        this.emitted += c.length;
        if (!this.push(c)) return;
        continue;
      }

      // ── 크로스페이드 구간 ──
      if (this.b && this.emitted >= this.switchAtBytes) {
        // 밀린 만큼 새 소스에서 버린다. b는 고정 위치로 seek돼 있고 우리 시계만 흘렀으므로,
        // 버리지 않으면 민 길이만큼 그대로 되풀이해 들린다.
        this._payDebt();

        const bReady = this.bDebt === 0 && (this.b.readableLength >= FRAME_BYTES || isEnded(this.b));
        if (!bReady) {
          // 새 소스가 아직 못 준다. 옛 소스에 여유가 남았으면 **멈추지 말고 전환 지점을 뒤로 민다** —
          // 여기서 기다리면 그게 곧 공백이고, 공백이 나는 순간 무이음으로 갈 이유가 없어진다.
          const c = this._take(this.a);
          if (c) {
            this.switchAtBytes = this.emitted + c.length;
            this.bDebt += c.length;
            this._slips++;
            this.emitted += c.length;
            if (!this.push(c)) return;
            continue;
          }
          // 옛 소스도 말랐다 — 더 밀 여유가 없다
          if (isEnded(this.a)) {
            this._completeSwitch();
            continue;
          }
          return this._await(this.b, false);
        }

        const b = this.b.read(FRAME_BYTES);
        if (!b) {
          // 새 소스가 끝났거나 프레임이 안 된다 — 페이드를 접고 넘어간다
          this._completeSwitch();
          continue;
        }
        const a = this.a.readableLength >= FRAME_BYTES || isEnded(this.a) ? this.a.read(FRAME_BYTES) : null;
        if (!a) {
          // 옛 소스가 말랐다 — 남은 페이드를 포기하고 b로. 공백보다 짧은 이음매가 낫다.
          this.b.unshift(b);
          this._completeSwitch();
          continue;
        }
        this.push(this._mix(a, b));
        this.faded += FRAME_BYTES;
        this.emitted += FRAME_BYTES;
        if (this.faded >= this.fadeBytes) this._completeSwitch();
        continue;
      }

      // ── 평소: a ──
      const c = this._take(this.a);
      if (!c) {
        // a가 말랐는데 전환이 예약돼 있으면 기다리지 않고 넘어간다(공백 최소화)
        if (this.b && isEnded(this.a)) {
          this._completeSwitch();
          continue;
        }
        return this._await(this.a, !this.b);
      }
      this.emitted += c.length;
      if (!this.push(c)) return;
    }
  }

  // 전환 지점을 민 만큼 새 소스 앞을 버린다. 데이터가 아직 없으면 빚으로 남겨 다음에 갚는다.
  _payDebt() {
    while (this.bDebt > 0 && this.b.readableLength > 0) {
      const d = this.b.read(Math.min(this.bDebt, this.b.readableLength));
      if (!d) break;
      this.bDebt -= d.length;
    }
    // 새 소스가 빚만큼도 남기지 않고 끝났다 — 더 갚을 방법이 없으니 접는다
    if (this.bDebt > 0 && isEnded(this.b) && this.b.readableLength === 0) this.bDebt = 0;
  }

  _mix(a, b) {
    const out = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < FRAME_BYTES; i += 2) {
      const t = Math.min(1, (this.faded + i) / this.fadeBytes);
      const v = a.readInt16LE(i) * Math.cos((t * Math.PI) / 2) + b.readInt16LE(i) * Math.sin((t * Math.PI) / 2);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i);
    }
    return out;
  }

  // 페이드를 끝내고 b를 현재 소스로 삼는다. 여러 경로에서 불리므로 한 번만 동작해야 한다.
  _completeSwitch() {
    if (this.switched) return;
    this.switched = true;
    this.faded = this.fadeBytes;
    const old = this.a;
    this.a = this.b;
    // 옛 소스는 더 볼 일이 없다. 바로 파괴해야 그 뒤의 ffmpeg가 파이프에 막힌 채
    // 트랙 끝까지 남아 있지 않는다(killOnStdoutClose가 stdout 닫힘으로 걸린다).
    try {
      old.destroy();
    } catch {
      /* 이미 정리됨 */
    }
    this.emit("switched", this.emittedMs);
  }

  // 소스에 아직 데이터가 없다. endWhenDone이면 소스가 끝났을 때 이 스트림도 끝낸다.
  _await(s, endWhenDone) {
    if (isEnded(s) && s.readableLength === 0) {
      if (endWhenDone) this.push(null);
      return;
    }
    if (this.waiting === s) return;
    this.waiting = s;
    // 둘 중 하나가 깨우면 나머지도 반드시 뗀다. 안 그러면 굶었다 깨어날 때마다 리스너가
    // 하나씩 쌓여 MaxListenersExceededWarning이 나고, 긴 트랙에서 계속 누적된다.
    const again = () => {
      s.off("readable", again);
      s.off("end", again);
      if (this.waiting === s) this.waiting = null;
      this._kick();
    };
    s.once("readable", again);
    s.once("end", again);
  }

  // @discordjs/voice는 리소스를 버릴 때 playStream(pipeline)을 파괴하고, pipeline은 그 파괴를
  // 소스까지 역전파한다. 그 사슬이 여기서 끊기면 ffmpeg의 stdout이 닫히지 않아
  // spawnFfmpeg의 killOnStdoutClose가 걸리지 않고, ffmpeg가 파이프에 막힌 채 남는다.
  // 레지스트리는 종료 백스톱이라 그때까지 좀비가 쌓인다 — 곡을 넘길 때마다 하나씩.
  _destroy(err, cb) {
    this.waiting = null;
    for (const s of [this.a, this.b]) {
      try {
        s?.destroy();
      } catch {
        /* 이미 정리됨 */
      }
    }
    cb(err);
  }
}

module.exports = { AudioSplicer, BYTES_PER_MS, FRAME_BYTES };
