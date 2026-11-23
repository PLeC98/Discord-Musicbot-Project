// 로그 언어 고르기: LOG_LANGUAGE(.env, 셸 환경) → OS 언어 → 기준 언어. 진입 파일이 첫 줄에서 부른다(.env를 읽는 진입은 app/env-bootstrap이 읽은 바로 뒤, 나머지는 choose-at-start).
// 설정, 로거보다 먼저 돌아 language 말고는 아무 모듈도 부르지 않는다. 전역 process.env와 Intl만 읽는다.
// OS 언어는 Node에 내장된 ICU의 기본 로케일이다. Windows는 표시 언어가 아니라 지역 형식, Linux, macOS는 LC_ALL, LC_MESSAGES, LANG 차례(C는 en-US)

import { LOG_LANGUAGES, setLogLanguage, type LogLanguage } from "./language.ts";

/** 적은 LOG_LANGUAGE를 쓸 수 없는 까닭. malformed: 언어 태그 형식이 아님, unavailable: 그 언어의 로그 문구가 없음 */
type LogLanguageNotice = { kind: "malformed" | "unavailable"; value: string };

// 언어 태그의 형식(언어 2 ~ 3자, 그 뒤 하이픈으로 이은 1 ~ 8자 조각)
const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/** 유닉스 로케일 형식(ko_KR.UTF-8, ko_KR@euro)을 태그 형식(ko-KR)으로. 인코딩과 modifier는 뗀다 */
const asTag = (value: string) => value.replace(/[.@].*$/, "").replaceAll("_", "-");

/** 태그와 정확히 같은 것, 그다음 언어 부분이 같은 것(en-US-u-va-posix는 en). 없으면 null */
function logLanguageOf(tag: string): LogLanguage | null {
  const lower = tag.toLowerCase();
  const primary = lower.split("-")[0];
  return LOG_LANGUAGES.find((one) => one === lower) ?? LOG_LANGUAGES.find((one) => one === primary) ?? null;
}

/** 적은 값(빈 값은 없는 것으로)과 OS 로케일로 고른 언어. 적은 값을 쓸 수 없으면 알림과 함께 OS 언어, 기준 언어 차례로 */
function pickLogLanguage(setting: string | undefined, osLocale: string | undefined): { language: LogLanguage; notice: LogLanguageNotice | null } {
  const value = setting?.trim() ?? "";
  let notice: LogLanguageNotice | null = null;
  if (value && !TAG.test(asTag(value))) notice = { kind: "malformed", value };
  else if (value) {
    const found = logLanguageOf(asTag(value));
    if (found) return { language: found, notice: null };
    notice = { kind: "unavailable", value };
  }
  const os = osLocale ? logLanguageOf(asTag(osLocale)) : null;
  return { language: os ?? LOG_LANGUAGES[0], notice };
}

/** OS 로케일(ICU 기본 로케일). 못 읽으면 undefined */
function osLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

// 로거가 생기기 전에 고르므로 알림은 들고 있다가 기동 때 app/main이 꺼내 찍는다
let pending: LogLanguageNotice | null = null;

/** 로그 언어를 고르고 정한다. 진입 파일의 첫 줄만 부른다 */
function chooseLogLanguage(env: Record<string, string | undefined> = process.env): void {
  const { language, notice } = pickLogLanguage(env.LOG_LANGUAGE, osLocale());
  setLogLanguage(language);
  pending = notice;
}

/** 고를 때 생긴 알림을 한 번 꺼낸다 */
function takeLogLanguageNotice(): LogLanguageNotice | null {
  const notice = pending;
  pending = null;
  return notice;
}

export { chooseLogLanguage, pickLogLanguage, takeLogLanguageNotice };
export type { LogLanguageNotice };
