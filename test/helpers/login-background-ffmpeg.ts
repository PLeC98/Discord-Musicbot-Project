// 로그인 배경 테스트가 쓰는 ffmpeg의 기능과 건너뛸 까닭을 판정한다. 봇이 기동 시 보는 검사(media/ffmpeg/trial)를 그대로 쓴다.
// node:test의 skip은 테스트를 등록할 때 정해지므로 테스트 파일 맨 위에서 await한다.
// CI는 고정한 ffmpeg 빌드(config/vendor-versions)를 다운로드한다. 그 빌드에는 다 있으므로 CI에서는 건너뛰지 않고 실패로 드러낸다(ffmpeg를 올리다 기능이 빠진 경우)

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { readsAnimatedWebp, tryEncoder } from "../../src/media/ffmpeg/trial.ts";
import * as encoders from "../../src/dashboard/login-background/encoders.ts";
import type { LoginBackgroundCodec } from "../../src/dashboard/contract/login-background.ts";

const ffmpegBin = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const NO_FFMPEG = "ffmpeg 바이너리 없음";
const IN_CI = Boolean(process.env.CI);
// CI 가 쓰는 빌드에 원래 없는 기능(코덱, 인코더 이름. "OS-CPU" 나 "OS" 마다). 이것만 빠졌으면 CI 에서도 실패가 아니라 건너뛴다.
// BtbN 은 winarm64 빌드에서 libvpx(VP9)를 빼고 만든다(scripts.d/50-libvpx.sh). macOS 는 CI 가 brew 의 ffmpeg 를 깔고, 그 빌드에는 libwebp_anim(움직이는 WebP 읽기는 된다), zscale(HDR 톤 매핑, 봇은 HDR 원본을 거절한다)이 없다
const BUILD_GAPS: Partial<Record<string, readonly string[]>> = { "win32-arm64": ["vp9"], darwin: ["libwebp_anim", "zscale"] };
/** 이 플랫폼에서 CI 가 쓰는 빌드에 원래 없는 기능인가 */
const knownGap = (feature: string) => [BUILD_GAPS[`${process.platform}-${process.arch}`], BUILD_GAPS[process.platform]].some((gaps) => gaps?.includes(feature));
/** 원래 없는 기능이면 CI 에서도 건너뛰기만, 아니면 skipFor */
const skipUnless = (gap: boolean, reason: string) => (gap ? { skip: `${reason}(이 플랫폼의 CI 빌드에 원래 없다)` } : skipFor(reason));

const failed = new Set<string>();
/** 건너뛸 까닭을 담은 옵션을 돌려준다. CI면 그 까닭으로 실패하는 테스트를 하나 남긴다(까닭마다 한 번) */
function skipFor(reason: string): { skip: string } {
  if (IN_CI && !failed.has(reason)) {
    failed.add(reason);
    test(`CI의 고정 ffmpeg 빌드에 필요한 기능이 있다: ${reason}`, () => assert.fail(reason));
  }
  return { skip: reason };
}

/** 테스트의 남은 확인을 건너뛴다(앞의 확인은 이미 돌았다). CI면 실패 처리한다 */
function skipRest(t: TestContext, reason: string) {
  if (IN_CI) assert.fail(reason);
  t.skip(reason);
}

/** ffmpeg만 있으면 되는 테스트의 옵션이다 */
const withFfmpeg = ffmpegBin ? { skip: false as const } : skipFor(NO_FFMPEG);

/** 움직이는 WebP를 만들고(샘플, libwebp_anim) 읽는(봇, ffmpeg 9.0 이상) 테스트의 옵션을 돌려준다. 지원하지 않으면 건너뛴다 */
async function withAnimatedWebp(): Promise<{ skip: string | false }> {
  if (!ffmpegBin) return skipFor(NO_FFMPEG);
  if (!(await tryEncoder("libwebp_anim", ["-loop", "0"])).ok) return skipUnless(knownGap("libwebp_anim"), "이 ffmpeg는 움직이는 WebP를 만들지 못한다(libwebp_anim 없음, 샘플을 만들 수 없다)");
  if (!(await readsAnimatedWebp())) return skipFor("이 ffmpeg는 움직이는 WebP를 읽지 못한다(9.0 이상 필요, 봇은 켜질 때 로그로 알린다)");
  return { skip: false };
}

/**
 * 봇이 켜질 때와 같이 인코더를 선택해 두고(encoders의 테스트), 그 코덱들의 인코더가 다 있어야 하는 테스트의 옵션을 주는 함수를 돌려준다.
 * 건너뛸지는 파일을 읽을 때 선택한 것으로 정한다(테스트가 _useEncoders로 바꿔 넣어도 따라가지 않는다)
 */
async function encoderGate(): Promise<(...codecs: LoginBackgroundCodec[]) => { skip: string | false }> {
  if (ffmpegBin) {
    encoders.startEncoderCheck();
    await encoders.encodersReady();
  }
  const has = new Set(encoders.encoderList().flatMap((one) => (one.encoder ? [one.codec] : [])));
  return (...codecs) => {
    const missing = codecs.filter((codec) => !has.has(codec));
    if (!ffmpegBin) return skipFor(NO_FFMPEG);
    if (!missing.length) return { skip: false };
    return skipUnless(missing.every(knownGap), `이 ffmpeg에 ${missing.join(", ")} 인코더가 없다`);
  };
}

export { withFfmpeg, withAnimatedWebp, encoderGate, skipFor, skipRest, knownGap };
