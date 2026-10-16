// 로그인 배경의 단계 실행기를 runner 에 단다(봇이 켜질 때 한 번). 단계마다 맡은 모듈: 받기 source(유튜브는 youtube) · 미리보기와 크기 어림 preview · 장면 띠 strip · 고해상도 받기 youtube
import { useExecutors, useRecounter } from "./runner.ts";
import { receive } from "./source.ts";
import { preview, recount } from "./preview.ts";
import { strip } from "./strip.ts";
import { highRes, receiveYoutube } from "./youtube.ts";

function registerStages() {
  useExecutors({ receive: (job) => (job.item.from === "youtube" ? receiveYoutube(job) : receive(job)), preview, strip, highRes });
  useRecounter(recount);
}

export { registerStages };
