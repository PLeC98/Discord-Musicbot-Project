// 로그인 배경의 단계 실행기를 runner 에 단다(봇이 켜질 때 한 번). 단계마다 맡은 모듈: 받기 source · 미리보기와 크기 어림 preview
import { useExecutors, useRecounter } from "./runner.ts";
import { receive } from "./source.ts";
import { preview, recount } from "./preview.ts";

function registerStages() {
  useExecutors({ receive, preview });
  useRecounter(recount);
}

export { registerStages };
