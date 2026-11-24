// 로그 문구의 진입점. L.<네임스페이스>.<키>(값)은 글이 아니라 서술자(event, args)를 낸다. 글은 쓰는 쪽이 그릴 시점의 로그 언어로 그린다.
// 언어 폴더(locales/<언어>/log/)를 밖에서 직접 부르지 않는다. 진입점과 문구표는 로그, 설정, Node 내장 모듈을 부르지 않는다(설정보다 먼저, node_modules 없이도 돈다).
// 화면 번들에 들어가는 모듈은 이것을 부르지 않는다(모든 언어의 로그 문구가 화면 번들에 실린다)

import * as ko from "../../../locales/ko/log/index.ts";
import { bundles } from "../text-bundle.ts";
import { LOG_LANGUAGES, LOG_TEST_LANGUAGE, logLanguage, type LogLanguage } from "./language.ts";
import { logText, plainArgs, type LogArgs, type LogText } from "./log-text.ts";

type LogSource = typeof ko;
const SOURCES: Readonly<Record<LogLanguage, LogSource>> = { ko };

const { textFor, missingText: missingLogText } = bundles(SOURCES, (text: LogSource) => text, { base: LOG_LANGUAGES[0], test: LOG_TEST_LANGUAGE });

// 문구 함수의 값 가운데 글 자리는 다른 서술자(라벨)도 받는다(그릴 때 글로 바꿔 넘긴다)
type Wide<A> = { [P in keyof A]: A[P] extends string ? string | LogText : A[P] };
type Describe<F> = F extends () => string ? () => LogText : F extends (args: infer A) => string ? (args: Wide<A>) => LogText : never;
/** 네임스페이스마다 문구 함수를 서술자를 내는 함수로 바꾼 표 */
type LogCatalog = { readonly [N in keyof LogSource]: { readonly [K in keyof LogSource[N]]: Describe<LogSource[N][K]> } };

type AnyEntry = (args: Record<string, unknown>) => string;

/** 문구 하나를 그릴 때의 로그 언어로 그린다(언어마다 번들이 따로라 그때 찾는다) */
const render = (space: string, key: string, args: LogArgs) => (textFor(logLanguage()) as unknown as Record<string, Record<string, AnyEntry>>)[space][key](plainArgs(args));

/** 네임스페이스 하나의 문구 함수들을 서술자를 내는 함수로 */
const describeSpace = (space: string, entries: object) => Object.freeze(Object.fromEntries(Object.keys(entries).map((key) => [key, (args: LogArgs = {}) => logText(`${space}.${key}`, args, () => render(space, key, args))])));

const L = Object.freeze(Object.fromEntries(Object.entries(ko).map(([space, entries]) => [space, describeSpace(space, entries)]))) as unknown as LogCatalog;

export { L, missingLogText };
export type { LogSource };
