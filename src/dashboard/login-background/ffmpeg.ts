// 로그인 배경의 ffmpeg 일. 자식 프로세스 레지스트리에 "로그인 배경"으로 올린다(봇 상태 탭의 하는 일).
// 긴 일(미리보기 · 어림 · 장면 바뀜 · 인코딩)은 진행이 멈추면 끊는다: 기기마다 속도가 크게 달라
// 고정 상한으로는 느린 기기의 정상 인코딩을 끊는다. 아주 넉넉한 상한(실시간의 300배 + 1시간)은 남긴다
import { runFfmpeg, PROGRESS_ARGS, type FfmpegJob } from "../../media/ffmpeg/job.ts";

/** 진행이 이만큼 멈추면 끊는다 */
const STALL_MS = 15 * 60_000;
/** 긴 일의 상한(구간 길이에 비례) */
const backstopFor = (seconds: number) => seconds * 300_000 + 3_600_000;

const ffmpeg = (args: string[], job: FfmpegJob = {}) => runFfmpeg(args, { label: "login-background", job: "login-background", ...job });

/** 긴 일: 진행이 멈추면 끊고 넉넉한 상한을 건다(인자에 PROGRESS_ARGS 가 있어야 한다) */
const longJob = (seconds: number): Pick<FfmpegJob, "stallMs" | "timeoutMs"> => ({ stallMs: STALL_MS, timeoutMs: backstopFor(seconds) });

export { ffmpeg, longJob, PROGRESS_ARGS, STALL_MS };
