// 기동의 첫 줄. 설정(config)을 읽기 전에 .env 가 없으면 만든다. 기동 파일 · 명령 배포 스크립트가 다른 무엇보다 먼저 불러온다.
// 만든 .env 는 필수 값이 비어 있어 바로 뒤의 설정 검사가 무엇을 채울지 알리며 멈춘다

import { setupEnv, madeLine } from "../config/env-file.ts";

// 로거는 설정을 읽어야 만들어지므로 아직 없다. 콘솔로 알린다
if (setupEnv()) console.warn(madeLine());
