// .env를 읽지 않는 진입 파일(scripts의 setup-config, launch, check-bot-stopped, 빌드 도구 등)의 첫 줄. 로그 언어를 고른다.
// .env를 읽는 진입은 app/env-bootstrap이 읽은 바로 뒤에 고른다(.env의 LOG_LANGUAGE를 보려고)

import { chooseLogLanguage } from "./choose-language.ts";

chooseLogLanguage();
