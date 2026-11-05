import { AudioPlayerStatus } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "sponsor" });
import type { Player } from "./player.ts";
import type { SkipSegment } from "../sources/sponsor-block.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { logTitle } from "../infra/log/title.ts";

/** 구간을 넘기며 읽고 부르는 플레이어 필드 */
type SkipHost = Pick<Player, "audioPlayer" | "currentTrack" | "getCurrentTime" | "isPlayStarting" | "isStopping" | "paused" | "play" | "skip" | "sponsor" | "playback">;
type Decision = { action: "seek"; toSec: number; prevSec: number } | { action: "end" | null; toSec?: undefined; prevSec: number };

// 재생 중 SponsorBlock 구간을 자동으로 건너뛴다.
//
// 구간 시작을 자연 재생으로 넘어설 때만 건너뛴다. prevSec→curSec 사이에
// seg.start가 들어오면 발동하고, play()(위치 이동 포함)마다 prevSec를 시작 위치로 다시 잡는다.
// 그래서 사용자가 구간 안으로 직접 옮기면 seg.start > prevSec 가 거짓이라 건너뛰지 않는다
// (따로 상태를 두지 않고 경계를 넘었는지만 본다).
//
// 구간 처리:
//  - 인트로, 중간: 위치 이동(play(end*1000))으로 구간 끝으로.
//  - 아웃트로, 끝(seg.end ≈ 곡 길이): 스킵과 같이 다음 곡으로(skip).

const TICK_MS = 500; // 확인 간격. 인트로가 이만큼까지 들릴 수 있다
const END_EPSILON_SEC = 1.5; // seg.end가 곡 끝에서 이 이내면 아웃트로로 본다

// 곡 끝 구간은 트는 음원의 길이로 본다. 모르면 표시 길이
const lengthSecOf = (p: SkipHost) => (p.playback?.lengthMs ?? 0) / 1000 || Number(p.currentTrack?.duration) || 0;

class SponsorSkipper {
  player: SkipHost;
  segments: SkipSegment[];
  _prevSec: number;
  _interval: NodeJS.Timeout | null;

  constructor(player: SkipHost) {
    this.player = player;
    this.segments = [];
    this._prevSec = -1;
    this._interval = null;
  }

  /**
   * 발동 판정(순수 함수). segments는 start 오름차순이어야 한다(SponsorBlock 정규화 결과).
   */
  static decide(segments: Array<Pick<SkipSegment, "start" | "end">>, prevSec: number, curSec: number, durationSec: number, endEpsilon = END_EPSILON_SEC): Decision {
    for (const seg of segments) {
      if (seg.start > prevSec && seg.start <= curSec) {
        if (durationSec > 0 && seg.end >= durationSec - endEpsilon) {
          return { action: "end", prevSec: seg.end };
        }
        return { action: "seek", toSec: seg.end, prevSec: seg.end };
      }
    }
    return { action: null, prevSec: curSec };
  }

  /** 재생을 시작하거나 위치를 옮길 때 부른다. 이번 재생의 구간, 기준점을 정하고 구간이 있으면 확인을 켠다 */
  onPlayStart(seekMs = 0) {
    const segs = this.player.sponsor?.skipSegments;
    this.segments = Array.isArray(segs) ? segs : [];
    // 처음부터 틀면(seekMs 0) prevSec를 -1로 두어 start 0 인 인트로도 넘어선 것으로 본다.
    this._prevSec = seekMs > 0 ? seekMs / 1000 : -1;
    if (this.segments.length) this._start();
    else this.stop();
  }

  _start() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      bestEffort(log, this._tick(), "건너뛸 구간 보기");
    }, TICK_MS);
    if (this._interval.unref) this._interval.unref();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _tick() {
    const p = this.player;
    if (!p.currentTrack || p.paused || !this.segments.length) return;
    // 셋업(play 진행) 중이거나 아직 실제 Playing이 아니면 발동 보류. 비캐시 곡의 초반
    // 스킵이 셋업 중인 play()에 재진입하면 재생이 깨진다.
    if (p.isPlayStarting) return;
    // 무음을 흘려보내며 멈추는 중이면 곡이 곧 바뀐다
    if (p.isStopping) return;
    if (p.audioPlayer?.state?.status !== AudioPlayerStatus.Playing) return;

    const curSec = p.getCurrentTime() / 1000;
    const durationSec = lengthSecOf(p);

    const d = SponsorSkipper.decide(this.segments, this._prevSec, curSec, durationSec);
    this._prevSec = d.prevSec;

    if (d.action === "end") {
      // 스킵과 트랙 종료 줄이 원인=sponsorblock 을 달고 따라나온다. 세 줄이 한 사건이다.
      log.debug(`${logTitle(p.currentTrack?.title)}: 종료 구간 도달, 트랙 종료`);
      p.skip("sponsorblock"); // 스킵 버튼과 같다(다음 곡, 반복을 따른다)
    } else if (d.action === "seek") {
      log.info(`${logTitle(p.currentTrack?.title)}: 구간 건너뜀 → ${Math.round(d.toSec)}s`);
      // play()가 onPlayStart를 다시 호출해 prevSec를 seek 지점으로 재설정한다.
      bestEffort(log, p.play(Math.round(d.toSec * 1000), { continued: true }), "구간 건너뛰기");
    }
  }
}

export type { SkipHost };
export { SponsorSkipper };
