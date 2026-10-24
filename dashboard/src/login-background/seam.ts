// 반복 전환 효과: 끝에 닿기 전에 걸고(멈춘 장면 겹치기 · 오버레이 색 · 검게 · 흐림), 처음으로 돌아간 때에 해제한다.
// 로그인 화면(LoginBackdrop, 구운 영상의 끝)과 편집 창(구간 끝)이 같이 쓴다. 레이어는 부르는 쪽이 그린다(흐림 크기 · 색은 그 틀에 맞춰)

import type { Ref } from "vue";
import type { LoginBackgroundOptions } from "../../../src/dashboard/contract/login-background.ts";

type Seam = LoginBackgroundOptions["seam"];
/** video: 영상, freeze: 멈춘 장면을 그릴 캔버스, pulse: 흐리는 레이어, dip: 오버레이 색 · 검정 레이어 */
type SeamLayers = { video: Ref<HTMLVideoElement | null>; freeze: Ref<HTMLCanvasElement | null>; pulse: Ref<HTMLElement | null>; dip: Ref<HTMLElement | null> };

/** 멈춘 장면 겹치기를 뜨는 때(끝에서 몇 장면 앞) */
const FREEZE_FRAMES = 1.5;

/** 불투명도를 ms 동안 to 로(0 이면 바로) */
function fade(el: HTMLElement | null, to: number, ms: number) {
  if (!el) return;
  el.style.transition = ms ? `opacity ${ms}ms linear` : "none";
  if (!ms) void el.offsetWidth;
  el.style.opacity = String(to);
}

function useSeam(layers: SeamLayers, seam: () => Seam) {
  let armed = false;
  /** 건 효과를 ms 동안 해제한다(0 이면 바로) */
  function release(ms: number) {
    fade(layers.freeze.value, 0, ms);
    fade(layers.pulse.value, 0, ms / 2);
    fade(layers.dip.value, 0, ms / 2);
    armed = false;
  }
  /** 처음으로 돌아갔다: 건 효과를 효과 길이 동안 해제한다 */
  function restarted() {
    if (armed) release(seam().seconds * 1000);
  }
  /** 재생 위치 t 가 끝(end)에 닿기 전이면 효과를 건다 */
  function near(t: number, end: number, fps: number) {
    if (armed) return;
    const { kind, seconds } = seam();
    const video = layers.video.value;
    if (kind === "freeze" && t >= end - FREEZE_FRAMES / fps) {
      const canvas = layers.freeze.value;
      if (!canvas || !video?.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      fade(canvas, 1, 0);
      armed = true;
      return;
    }
    const layer = kind === "blur" ? layers.pulse.value : kind === "cover" || kind === "black" ? layers.dip.value : null;
    if (layer && t >= end - seconds / 2) {
      fade(layer, 1, (seconds * 1000) / 2);
      armed = true;
    }
  }
  return { near, restarted, release };
}

export { useSeam };
