// 로그인 배경 테스트가 쓰는 ffmpeg 의 능력과 건너뛸 까닭. 봇이 실행 때 보는 검사(media/ffmpeg/trial)를 그대로 쓴다.
// node:test 의 skip 은 테스트를 등록할 때 정해지므로 테스트 파일 맨 위에서 await 한다.
// CI 는 고정한 ffmpeg 빌드(config/vendor-versions)를 받는다. 그 빌드에는 다 있으므로 CI 에서는 건너뛰지 않고 실패로 드러낸다(ffmpeg 를 올리다 능력을 잃은 것)

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

const failed = new Set<string>();
/** 건너뛸 까닭. CI 면 그 까닭으로 실패하는 테스트를 하나 남긴다(까닭마다 한 번) */
function skipFor(reason: string): { skip: string } {
  if (IN_CI && !failed.has(reason)) {
    failed.add(reason);
    test(`CI 의 고정 ffmpeg 빌드에 있어야 할 능력: ${reason}`, () => assert.fail(reason));
  }
  return { skip: reason };
}

/** 테스트의 남은 확인을 건너뛴다(앞의 확인은 이미 돌았다). CI 면 실패 */
function skipRest(t: TestContext, reason: string) {
  if (IN_CI) assert.fail(reason);
  t.skip(reason);
}

/** ffmpeg 만 있으면 되는 테스트 */
const withFfmpeg = ffmpegBin ? { skip: false as const } : skipFor(NO_FFMPEG);

/** 움직이는 WebP 를 만들고(표본, libwebp_anim) 읽는(봇, ffmpeg 9.0 이상) 테스트. 못 하면 건너뛸 까닭 */
async function withAnimatedWebp(): Promise<{ skip: string | false }> {
  if (!ffmpegBin) return skipFor(NO_FFMPEG);
  if (!(await tryEncoder("libwebp_anim", ["-loop", "0"])).ok) return skipFor("이 ffmpeg 는 움직이는 WebP 를 만들지 못한다(libwebp_anim 없음, 표본을 만들 수 없다)");
  if (!(await readsAnimatedWebp())) return skipFor("이 ffmpeg 는 움직이는 WebP 를 읽지 못한다(9.0 이상 필요, 봇은 켜질 때 로그로 알린다)");
  return { skip: false };
}

/**
 * 봇이 켜질 때와 같이 인코더를 골라 두고(encoders 의 테스트), 그 코덱들의 인코더가 다 있어야 하는 테스트의 옵션을 주는 함수를 돌려준다.
 * 건너뛸지는 파일을 읽을 때 고른 것으로 정한다(테스트가 _useEncoders 로 바꿔 넣어도 따라가지 않는다)
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
    return missing.length ? skipFor(`이 ffmpeg 에 ${missing.join(", ")} 인코더가 없다`) : { skip: false };
  };
}

export { withFfmpeg, withAnimatedWebp, encoderGate, skipFor, skipRest };
