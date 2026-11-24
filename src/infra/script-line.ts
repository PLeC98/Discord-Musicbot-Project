// 터미널 스크립트(install:*, pnpm commands, pnpm install의 단계)가 찍는 한 줄. 봇 로그와 같은 모양(INFO  [분류] 내용, 명사형 끝)이고 이모지를 쓰지 않는다.
// 모양을 봇 로그와 맞추는 것은 통일성 때문이고, 이모지는 Windows 콘솔(cmd)에서 깨지기 쉽다.
// 로거를 불러올 수 없는 스크립트가 쓴다(로거는 console을 가로채고, pnpm install의 첫 단계에는 node_modules가 없다). 로그 문구 서술자(infra/log/log-text, 아무것도 부르지 않는다)만 부른다

import { renderLogText, type LogText } from "./log/log-text.ts";

type ScriptLevel = "info" | "warn" | "error";

/** category 분류로 찍는 함수. info는 표준 출력, warn과 error는 표준 오류. line: 로그 문구 서술자(로그 언어로 그린다) */
function scriptLine(category: string): (level: ScriptLevel, line: LogText) => void {
  return (level, line) => {
    const text = `${level.toUpperCase().padEnd(5)} [${category}] ${renderLogText(line)}`;
    if (level === "info") console.log(text);
    else console.error(text);
  };
}

/** 이 모양의 줄에서 앞의 수준과 분류를 뗀다(봇이 스크립트 출력을 자기 로그에 옮겨 적을 때) */
const stripScriptPrefix = (line: string) => line.replace(/^(INFO|WARN|ERROR)\s+\[[^\]]+\]\s*/, "");

export { scriptLine, stripScriptPrefix };
export type { ScriptLevel };
