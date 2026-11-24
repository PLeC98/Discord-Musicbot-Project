// 봇 문구의 진입점. 언어를 받아 그 언어의 번들을 준다(언어를 고르는 것은 ui/language). 언어 폴더(locales/<언어>/bot/)를 밖에서 직접 부르지 않는다

import * as ko from "../../../locales/ko/bot/index.ts";
import type { TextShape } from "./contract.ts";
import { bundles, withErrors } from "./bundle.ts";
import type { TextLanguage } from "../../rules/languages.ts";

/** 언어 모듈 번들이 맞출 모양 */
type BotSource = TextShape<typeof ko>;

const SOURCES: Readonly<Record<TextLanguage, BotSource>> = { ko };

const { textFor, missingText } = bundles(SOURCES, withErrors<BotSource>);

/** 한 언어의 봇 문구 */
type BotText = ReturnType<typeof textFor>;

export { textFor, missingText };
export type { BotText, BotSource };
