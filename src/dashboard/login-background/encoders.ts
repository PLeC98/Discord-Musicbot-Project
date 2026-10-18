// 로그인 배경을 인코딩하는 인코더. 봇이 켜질 때마다 코덱마다 후보를 작은 테스트로 돌려 쓸 수 있는 첫 것을 선택한다(뒤에서, 봇 시작을 막지 않는다. 이 PC 에서 1초 안쪽).
// 기록해 두지 않는다: 기기가 바뀌었는지 알아보는 비용(Windows 의 장치 정보 읽기)이 테스트의 절반쯤이고, 드라이버 · 라이브러리만 바뀌어도 늘 맞는다. 인코딩하다 인코더가 실패하면 다시 테스트한다(recheck).
// 후보는 같은 화질이 되는 값을 재 둔 인코더만이다: AV1 은 SVT-AV1, VP9 은 libvpx, H.264 는 NVENC → OpenH264 → x264(OpenH264 가 없는 ffmpeg 몫. 720p 는 고정 비트레이트 규격이라 같은 규격으로).
// 하드웨어 AV1 · VP9 은 값을 재면 더한다

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../../rules/error-kind.ts";
import { readsAnimatedWebp, tryEncoder } from "../../media/ffmpeg/trial.ts";
import { LOGIN_BG_CODECS, type LoginBackgroundCodec, type LoginBackgroundEncoder } from "../contract/login-background.ts";

/** 후보 하나. options 는 테스트에 거는 옵션(실제 인코딩의 핵심만: 10비트 · 비트레이트 방식 등, 거기서 실패하면 인코딩도 실패한다) */
type Candidate = { encoder: string; hardware: boolean; options: string[] };
const CANDIDATES: Record<LoginBackgroundCodec, Candidate[]> = {
  av1: [{ encoder: "libsvtav1", hardware: false, options: ["-preset", "12", "-pix_fmt", "yuv420p10le"] }],
  vp9: [{ encoder: "libvpx-vp9", hardware: false, options: ["-deadline", "good", "-cpu-used", "8", "-crf", "34", "-b:v", "0"] }],
  h264: [
    { encoder: "h264_nvenc", hardware: true, options: ["-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "2200k", "-bf", "2"] },
    { encoder: "libopenh264", hardware: false, options: ["-b:v", "2500k"] },
    { encoder: "libx264", hardware: false, options: ["-b:v", "2500k", "-bf", "0"] },
  ],
};
/** 장치가 없어서 못 쓰는 것(까닭으로 보이지 않는다). 그 밖의 실패(드라이버가 낡음 등)는 운영자에게 까닭을 보인다 */
const ABSENT = /cannot load|no .*capable devices|CUDA_ERROR_NO_DEVICE|could not dynamically load|dlopen/i;

let encoders: LoginBackgroundEncoder[] = [];
let animatedWebp = false;
let running: Promise<void> | null = null;

/** 코덱 하나: 후보를 순서대로 테스트해 처음 되는 것. 앞 후보가 장치가 있는데 실패했으면 그 까닭을 남긴다 */
async function pick(codec: LoginBackgroundCodec): Promise<LoginBackgroundEncoder> {
  let why: string | null = null;
  for (const candidate of CANDIDATES[codec]) {
    const result = await tryEncoder(candidate.encoder, candidate.options);
    if (result.ok) return { codec, encoder: candidate.encoder, hardware: candidate.hardware, why };
    if (!ABSENT.test(result.reason)) why ??= `${candidate.encoder}: ${result.reason}`;
  }
  return { codec, encoder: null, hardware: false, why: why ?? "쓸 수 있는 인코더가 없습니다" };
}

async function check() {
  const picked: LoginBackgroundEncoder[] = [];
  for (const codec of LOGIN_BG_CODECS) picked.push(await pick(codec));
  encoders = picked;
  animatedWebp = await readsAnimatedWebp();
  log.info(`로그인 배경 인코더: ${picked.map((one) => `${one.codec} ${one.encoder ?? "없음"}`).join(" · ")}${animatedWebp ? "" : " · 움직이는 WebP 를 읽지 못합니다(ffmpeg 9.0 이상 필요)"}`);
  for (const one of picked) if (one.why) log.warn(`로그인 배경 ${one.codec}: ${one.why}`);
}

/** 테스트한다(이미 하는 중이면 그것을 기다린다) */
function run(): Promise<void> {
  running ??= check()
    .catch((error: unknown) => log.error(`로그인 배경 인코더 테스트가 실패했습니다: ${messageOf(error)}`))
    .finally(() => (running = null));
  return running;
}

/** 봇이 켜질 때: 뒤에서 테스트한다 */
function startEncoderCheck() {
  void run();
}
/** 다시 테스트한다(인코딩하다 인코더가 실패했을 때 · 운영자가 손으로) */
const recheck = () => run();
/** 테스트가 끝날 때까지 기다린다(인코딩 전에) */
const encodersReady = async () => {
  if (running) await running;
};
const encoderList = () => encoders;
const isChecking = () => running !== null;
/** 그 코덱으로 인코딩하는 인코더(없으면 null) */
const encoderFor = (codec: LoginBackgroundCodec) => encoders.find((one) => one.codec === codec)?.encoder ?? null;
const canReadAnimatedWebp = () => animatedWebp;

/** 테스트: 선택한 인코더를 바꿔 넣는다(인코더가 없는 기기 흉내) */
function _useEncoders(list: LoginBackgroundEncoder[]) {
  encoders = list;
}

/** 테스트: 선택한 것을 잊는다 */
function _reset() {
  encoders = [];
  animatedWebp = false;
  running = null;
}

export { startEncoderCheck, recheck, encodersReady, encoderList, isChecking, encoderFor, canReadAnimatedWebp, _reset, _useEncoders, CANDIDATES };
