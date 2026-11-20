// 문구 번들의 계약(타입만, Node 없는 모듈. 화면도 타입을 가져온다).
// 언어 모듈은 기준 언어(한국어) 모듈과 같은 모양이어야 한다. 문구 문자열은 언어마다 다르니 string으로 넓히고, 뜻이 있는 값(아이콘 키, 주제, 경고 수준, 문제 코드)은 그대로 둔다

import type { IconKey } from "../icons.ts";
import type { Code } from "../../rules/problems.ts";
import type { Notice, Topic } from "./notice.ts";
import type * as koShared from "./ko/shared.ts";

/** 넓히지 않는 값. 언어별로 바뀌면 안 되는 유니온을 여기에 더한다(빠뜨리면 그 값이 string으로 넓어진다) */
type Semantic = IconKey | Topic | Notice["severity"] | Code;

/**
 * 언어 모듈이 맞출 모양. 함수는 반환 타입을 넓혀도 원래와 같으면 원형을 유지한다(일괄로 다시 쓰면 제네릭이 굳어 errors.notice의 코드별 값 검사가 사라진다)
 */
type TextShape<T> = T extends Semantic ? T : T extends string ? string : T extends (...args: infer A) => infer R ? ([TextShape<R>] extends [R] ? T : (...args: A) => TextShape<R>) : T extends object ? { [K in keyof T]: TextShape<T[K]> } : T;

/** 화면과 그리기 워커도 쓰는 봇 문구(ui/text/<언어>/shared)의 모양 */
type SharedSource = TextShape<typeof koShared>;

export type { TextShape, SharedSource };
