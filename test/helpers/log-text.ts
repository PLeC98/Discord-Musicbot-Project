// 테스트가 로그 문구 자리(라벨, 원인, 예외 메시지)에 넘기는 글: 그 글 그대로 그리는 서술자

import { logText, type LogText } from "../../src/infra/log/log-text.ts";

/** 글 그대로 그리는 테스트 서술자. 글을 값에도 실어 같은 글이면 같은 문구로 본다(repeatingFailure의 같은 실패 비교) */
const testText = (text: string): LogText => logText("test.text", { text }, () => text);

export { testText };
