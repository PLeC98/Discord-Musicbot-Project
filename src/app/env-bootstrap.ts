// 진입 파일의 첫 줄. 설정(config)을 읽기 전에 .env 가 없으면 만들고, 읽어 process.env 에 올린다.
// 설정에 닿는 진입 파일(기동 · scripts)이 다른 무엇보다 먼저 불러온다(test/architecture 가 지킨다).
// 만든 .env 는 필수 값이 비어 있어 바로 뒤의 설정 검사가 무엇을 채울지 알리며 멈춘다

import { setupEnv, loadEnv, madeLine } from "../config/env-file.ts";

// 로거는 설정을 읽어야 만들어지므로 아직 없다. 콘솔로 알린다
if (setupEnv()) console.warn(madeLine());
loadEnv();
