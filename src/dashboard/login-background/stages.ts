// 로그인 배경의 단계 실행기를 runner 에 단다(봇이 켜질 때 한 번). 단계마다 맡은 모듈: 받기 source
import { useExecutors } from "./runner.ts";
import { receive } from "./source.ts";

function registerStages() {
  useExecutors({ receive });
}

export { registerStages };
