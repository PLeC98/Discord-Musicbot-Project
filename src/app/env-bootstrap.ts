// 진입 파일의 첫 줄. 설정(config)을 읽기 전에 .env가 없으면 만들고, 읽어 process.env에 올린 뒤 로그 언어를 고른다(.env의 LOG_LANGUAGE를 보려고 읽은 바로 뒤).
// 설정에 닿는 진입 파일(기동, scripts)이 다른 무엇보다 먼저 불러온다(test/architecture가 지킨다).
// 만든 .env는 필수 값이 비어 있어 바로 뒤의 설정 검사가 무엇을 채울지 알리며 멈춘다

import { setupEnv, loadEnv, madeLine } from "../config/env-file.ts";
import { chooseLogLanguage } from "../infra/log/choose-language.ts";

const made = setupEnv();
loadEnv();
chooseLogLanguage();
// 로거는 설정을 읽어야 만들어지므로 아직 없다. 고른 언어로 찍도록 고른 뒤에 콘솔로 알린다
if (made) console.warn(madeLine());
