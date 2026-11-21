// 화면(대시보드)과 그리기 워커도 쓰는 봇 문구의 진입점(Node 없는 모듈). 봇은 ui/text/index를 쓴다

import * as ko from "../../../locales/ko/bot/shared.ts";
import type { SharedSource } from "./contract.ts";
import { bundles, withErrors } from "./bundle.ts";
import type { TextLanguage } from "../../rules/languages.ts";

const SOURCES: Readonly<Record<TextLanguage, SharedSource>> = { ko };

const { textFor: sharedTextFor, missingText: missingSharedText } = bundles(SOURCES, withErrors<SharedSource>);

/** 화면(대시보드)도 함께 쓰는 한 언어의 봇 문구 */
type SharedText = ReturnType<typeof sharedTextFor>;

export { sharedTextFor, missingSharedText };
export type { SharedText };
export type { AddedTracks, Shortfall } from "../../../locales/ko/bot/added-parts.ts";
