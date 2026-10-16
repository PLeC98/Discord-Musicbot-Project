// 로그인 배경의 ffmpeg 일. 자식 프로세스 장부에 "로그인 배경"으로 올린다(봇 상태 탭의 하는 일)
import { runFfmpeg, type FfmpegJob } from "../../media/ffmpeg/job.ts";

const ffmpeg = (args: string[], job: FfmpegJob = {}) => runFfmpeg(args, { label: "login-background", job: "login-background", ...job });

export { ffmpeg };
