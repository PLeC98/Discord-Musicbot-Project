// 휴대폰 대기열 시트를 끝까지 펼치는 함수의 키. 시트(QueueSheet)가 내주고 곡 추가 칸이 입력란을 누르면 부른다(접힌 시트 안에서는 결과 목록이 스크롤되지 않는다)

import type { InjectionKey } from "vue";

export const SHEET_EXPAND: InjectionKey<() => void> = Symbol("sheet-expand");
